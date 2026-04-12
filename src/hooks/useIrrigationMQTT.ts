import { useState, useEffect, useCallback, useRef } from "react";
import { useMQTT } from "./useMQTT";

export interface PumpRuntime {
  active: boolean;
  mode: "idle" | "countdown" | "elapsed";
  seconds: number;
  remainingSec: number;
  elapsedSec: number;
}

export interface IrrigationSnapshot {
  mode: "manual" | "automatic";
  time_valid: boolean;
  time_source: string;
  wifi_connected: boolean;
  mqtt_connected: boolean;
  wifi_state_text: string;
  wifi_detail: string;
  pump_on: boolean;
  pump_runtime: PumpRuntime | null;
  sectorization_enabled: boolean;
  sectors: Array<{ index: number; enabled: boolean; name: string; open: boolean }>;
  next_event: string;
  next_event_type: string;
  next_event_target: number;
  next_event_time: string;
  warning: string;
  clock: string;
  fw_version: string;
  sta_ip: string;
}

export interface HistoryEvent {
  timestamp: string;
  description: string;
  category: "manual" | "automacao" | "conectividade" | "mqtt" | "seguranca" | "sistema";
}

export interface IrrigationFullConfig {
  mode: string;
  sectorization_enabled: boolean;
  sectors: Array<{ index: number; enabled: boolean; name: string }>;
  pump: Record<string, unknown>;
  system: Record<string, unknown>;
  relay: Record<string, unknown>;
}

export interface ScheduleItem {
  id: number;
  enabled: boolean;
  target_type: "pump" | "sector";
  target_index?: number;
  start_time: string;
  duration_min: number;
  days: string[];
}

interface CommandResponse {
  ok: boolean;
  code: string;
  message: string;
  data?: unknown;
  state?: Record<string, unknown>;
  command: string;
  request_id: string;
  ack?: boolean;
}

interface PendingCommand {
  resolve: (resp: CommandResponse) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

function normalizeScheduleItem(raw: Record<string, unknown>): ScheduleItem {
  const targetType = String(raw.target_type ?? raw.targetType ?? "pump");
  const rawStartTime = raw.start_time ?? raw.startTime;
  const hour = Number(raw.hour ?? 0);
  const minute = Number(raw.minute ?? 0);

  return {
    id: Number(raw.id ?? 0),
    enabled: Boolean(raw.enabled ?? true),
    target_type: targetType === "sector" ? "sector" : "pump",
    target_index:
      targetType === "sector"
        ? Number(raw.target_index ?? raw.targetIndex ?? 1)
        : undefined,
    start_time:
      typeof rawStartTime === "string" && rawStartTime.length > 0
        ? rawStartTime
        : `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    duration_min: Number(raw.duration_min ?? raw.durationMin ?? 0),
    days: Array.isArray(raw.days) ? raw.days.map((day) => String(day)) : [],
  };
}

function buildAddScheduleParams(schedule: Omit<ScheduleItem, "id">): Record<string, unknown> {
  return {
    target_type: schedule.target_type,
    ...(schedule.target_type === "sector" ? { target_index: schedule.target_index ?? 1 } : {}),
    enabled: schedule.enabled,
    start_time: schedule.start_time,
    duration_min: schedule.duration_min,
    days: schedule.days,
  };
}

function buildUpdateScheduleParams(schedule: Partial<ScheduleItem> & { id: number }): Record<string, unknown> {
  return {
    id: schedule.id,
    ...(schedule.enabled !== undefined ? { enabled: schedule.enabled } : {}),
    ...(schedule.start_time ? { start_time: schedule.start_time } : {}),
    ...(schedule.duration_min !== undefined ? { duration_min: schedule.duration_min } : {}),
    ...(schedule.days ? { days: schedule.days } : {}),
  };
}

function parseDataToSnapshot(raw: Record<string, unknown>): IrrigationSnapshot {
  const rawSectors = (raw.sectors as Array<Record<string, unknown>> || []).map(s => ({
    index: Number(s.index ?? 0),
    enabled: Boolean(s.enabled),
    name: String(s.name || `Setor ${s.index}`),
    open: Boolean(s.open),
  }));

  let mode: "manual" | "automatic" = "automatic";
  if (raw.manual_mode !== undefined) mode = raw.manual_mode ? "manual" : "automatic";
  else if (raw.manualMode !== undefined) mode = raw.manualMode ? "manual" : "automatic";
  else if (raw.mode !== undefined) mode = raw.mode === "manual" ? "manual" : "automatic";

  // Parse pump_runtime
  const rawRuntime = (raw.pump_runtime ?? raw.pumpRuntime) as Record<string, unknown> | undefined;
  const pumpRuntime: PumpRuntime | null = rawRuntime ? {
    active: Boolean(rawRuntime.active ?? false),
    mode: (String(rawRuntime.mode ?? "idle") as PumpRuntime["mode"]),
    seconds: Number(rawRuntime.seconds ?? 0),
    remainingSec: Number(rawRuntime.remainingSec ?? rawRuntime.remaining_sec ?? 0),
    elapsedSec: Number(rawRuntime.elapsedSec ?? rawRuntime.elapsed_sec ?? 0),
  } : null;

  return {
    mode,
    time_valid: Boolean(raw.time_valid ?? raw.timeValid ?? true),
    time_source: String(raw.time_source || raw.timeSource || "ntp"),
    wifi_connected: Boolean(raw.wifi_connected ?? raw.wifiConnected ?? false),
    mqtt_connected: Boolean(raw.mqtt_connected ?? raw.mqttConnected ?? false),
    wifi_state_text: String(raw.wifiStateText ?? raw.wifi_state_text ?? ""),
    wifi_detail: String(raw.wifiDetail ?? raw.wifi_detail ?? ""),
    pump_on: Boolean(raw.pump_on ?? raw.pumpOn ?? false),
    pump_runtime: pumpRuntime,
    sectorization_enabled: Boolean(raw.sectorization_enabled ?? raw.sectorizationEnabled ?? false),
    sectors: rawSectors,
    next_event: String(raw.next_event ?? ""),
    next_event_type: "",
    next_event_target: 0,
    next_event_time: "",
    warning: String(raw.overlap_warnings || raw.overlapWarnings || raw.warning || ""),
    clock: String(raw.clock ?? ""),
    fw_version: String(raw.fw_version ?? raw.fwVersion ?? ""),
    sta_ip: String(raw.sta_ip ?? raw.staIp ?? ""),
  };
}

function categorizeEvent(text: string): HistoryEvent["category"] {
  const lower = text.toLowerCase();
  if (lower.includes("proteção") || lower.includes("protecao") || lower.includes("segurança") || lower.includes("seguranca")) return "seguranca";
  if (lower.includes("wi-fi") || lower.includes("wifi") || lower.includes("rede") || lower.includes("reconect")) return "conectividade";
  if (lower.includes("mqtt")) return "mqtt";
  if (lower.includes("manual")) return "manual";
  if (lower.includes("horário") || lower.includes("horario") || lower.includes("automát") || lower.includes("automat") || lower.includes("agendamento") || lower.includes("schedule")) return "automacao";
  return "sistema";
}

function parseHistoryEntry(entry: string, category: HistoryEvent["category"]): HistoryEvent {
  // Format: "2026-04-11 18:10:00 | Description"
  const pipeIdx = entry.indexOf("|");
  if (pipeIdx > 0) {
    return {
      timestamp: entry.substring(0, pipeIdx).trim(),
      description: entry.substring(pipeIdx + 1).trim(),
      category,
    };
  }
  return { timestamp: new Date().toISOString(), description: entry, category };
}

interface UseIrrigationMQTTOptions {
  deviceId: string;
  autoConnect?: boolean;
  commandTimeout?: number;
}

export function useIrrigationMQTT({ deviceId, autoConnect = true, commandTimeout = 15000 }: UseIrrigationMQTTOptions) {
  const [snapshot, setSnapshot] = useState<IrrigationSnapshot | null>(null);
  const [fullConfig, setFullConfig] = useState<IrrigationFullConfig | null>(null);
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [pendingCommands, setPendingCommands] = useState<Set<string>>(new Set());
  const [lastSnapshotTime, setLastSnapshotTime] = useState<Date | null>(null);
  const [securityAlert, setSecurityAlert] = useState<string | null>(null);

  const addHistoryEvent = useCallback((description: string, category: HistoryEvent["category"]) => {
    setHistory(prev => {
      const event: HistoryEvent = { timestamp: new Date().toISOString(), description, category };
      return [event, ...prev].slice(0, 200);
    });
  }, []);
  const pendingRef = useRef<Map<string, PendingCommand>>(new Map());
  const requestCounter = useRef(0);

  const generateRequestId = useCallback(() => {
    requestCounter.current += 1;
    const ts = Date.now();
    return `req_${ts}_${String(requestCounter.current).padStart(3, "0")}`;
  }, []);

  const handleMessage = useCallback((message: { topic: string; payload: Record<string, unknown> }) => {
    const payload = message.payload;
    const payloadDeviceId = String(payload.device_id || "");
    if (payloadDeviceId && payloadDeviceId !== deviceId) return;

    // Check if it's a status/response message (has request_id + type=command_result)
    if (payload.request_id && (payload.type === "command_result" || payload.ok !== undefined)) {
      const rid = String(payload.request_id);
      const pending = pendingRef.current.get(rid);
      if (pending) {
        clearTimeout(pending.timeout);
        pendingRef.current.delete(rid);
        setPendingCommands(prev => {
          const next = new Set(prev);
          next.delete(rid);
          return next;
        });
        pending.resolve(payload as unknown as CommandResponse);
      }

      // Also handle specific response data
      const cmd = String(payload.command || "");
      const respData = payload.data as Record<string, unknown> | undefined;

      // Update snapshot from state block in ack response
      const stateData = payload.state as Record<string, unknown> | undefined;
      if (stateData) {
        setSnapshot(prev => {
          const updated = parseDataToSnapshot(stateData);
          // Merge: keep fields from previous snapshot that aren't in state
          return prev ? { ...prev, ...updated } : updated;
        });
        setLastSnapshotTime(new Date());
      }

      if (cmd === "list_schedules" && respData?.schedules && Array.isArray(respData.schedules)) {
        setSchedules((respData.schedules as Record<string, unknown>[]).map(normalizeScheduleItem));
      }
      if (cmd === "get_logs" && respData?.logs) {
        setLogs(respData.logs as string[]);
      }
      if (cmd === "get_full_config" && respData) {
        setFullConfig(respData as unknown as IrrigationFullConfig);
      }
      if (cmd === "get_runtime_state" && respData) {
        setSnapshot(parseDataToSnapshot(respData as Record<string, unknown>));
        setLastSnapshotTime(new Date());
      }

      // Track command as history event
      const msg = String(payload.message || "");
      if (msg) {
        const category = categorizeEvent(msg);
        addHistoryEvent(msg, category);
      }

      return;
    }

    // Data snapshot message
    if (payload.data && typeof payload.data === "object") {
      const data = payload.data as Record<string, unknown>;
      setSnapshot(parseDataToSnapshot(data));
      setLastSnapshotTime(new Date());

      // Check for security protection in history/logs
      const diagnostics = data.diagnostics as Record<string, unknown> | undefined;
      if (diagnostics?.history && Array.isArray(diagnostics.history)) {
        const entries = (diagnostics.history as Array<{ entry: string }>).map(h => {
          const category = categorizeEvent(h.entry);
          return parseHistoryEntry(h.entry, category);
        });
        if (entries.length > 0) {
          setHistory(prev => {
            const merged = [...entries, ...prev];
            return merged.slice(0, 200); // keep last 200
          });
        }
        // Check for security alerts
        const securityEntries = entries.filter(e => e.category === "seguranca");
        if (securityEntries.length > 0) {
          setSecurityAlert(securityEntries[0].description);
        }
      }
    }
  }, [deviceId]);

  const { status: mqttStatus, publish, error: mqttError } = useMQTT({
    deviceId,
    autoConnect,
    onMessage: handleMessage,
  });

  const sendCommand = useCallback((command: string, params: Record<string, unknown> = {}): Promise<CommandResponse> => {
    const requestId = generateRequestId();
    const message = {
      device_id: deviceId,
      request_id: requestId,
      command,
      params,
      timestamp: new Date().toISOString(),
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingRef.current.delete(requestId);
        setPendingCommands(prev => {
          const next = new Set(prev);
          next.delete(requestId);
          return next;
        });
        reject(new Error(`Timeout: sem resposta para "${command}" em ${commandTimeout / 1000}s`));
      }, commandTimeout);

      pendingRef.current.set(requestId, { resolve, reject, timeout });
      setPendingCommands(prev => new Set(prev).add(requestId));

      publish(`devices/${deviceId}/commands`, message);
    });
  }, [deviceId, publish, generateRequestId, commandTimeout]);

  // Convenience methods
  const requestUpdate = useCallback(() => sendCommand("request_update"), [sendCommand]);
  const getRuntimeState = useCallback(() => sendCommand("get_runtime_state"), [sendCommand]);
  const getFullConfig = useCallback(() => sendCommand("get_full_config"), [sendCommand]);
  const listSchedules = useCallback((targetType = "all") => sendCommand("list_schedules", { target_type: targetType }), [sendCommand]);
  const setMode = useCallback((mode: "manual" | "automatic") => sendCommand("set_mode", { mode }), [sendCommand]);
  const setPump = useCallback((on: boolean) => sendCommand("set_pump", { on }), [sendCommand]);
  const setSector = useCallback((index: number, open: boolean) => sendCommand("set_sector", { index, open }), [sendCommand]);
  const getLogs = useCallback((limit = 100) => sendCommand("get_logs", { limit }), [sendCommand]);
  const clearLogs = useCallback(() => sendCommand("clear_logs"), [sendCommand]);
  const setSectorization = useCallback((enabled: boolean) => sendCommand("set_sectorization", { enabled }), [sendCommand]);
  const setSectorEnabled = useCallback((index: number, enabled: boolean) => sendCommand("set_sector_enabled", { index, enabled }), [sendCommand]);
  const setSectorName = useCallback((index: number, name: string) => sendCommand("set_sector_name", { index, name }), [sendCommand]);
  const setPumpConfig = useCallback((config: Record<string, unknown>) => sendCommand("set_pump_config", config), [sendCommand]);
  const setSystemConfig = useCallback((config: Record<string, unknown>) => sendCommand("set_system_config", config), [sendCommand]);
  const setRelayConfig = useCallback((config: Record<string, unknown>) => sendCommand("set_relay_config", config), [sendCommand]);
  const setDatetime = useCallback((datetime: string) => sendCommand("set_datetime", { datetime }), [sendCommand]);
  const addSchedule = useCallback(
    (schedule: Omit<ScheduleItem, "id">) => sendCommand("add_schedule", buildAddScheduleParams(schedule)),
    [sendCommand]
  );
  const updateSchedule = useCallback(
    (schedule: Partial<ScheduleItem> & { id: number }) => sendCommand("update_schedule", buildUpdateScheduleParams(schedule)),
    [sendCommand]
  );
  const deleteSchedule = useCallback((id: number) => sendCommand("delete_schedule", { id }), [sendCommand]);
  const setScheduleEnabled = useCallback((id: number, enabled: boolean) => sendCommand("set_schedule_enabled", { id, enabled }), [sendCommand]);

  // Cleanup pending commands on unmount
  useEffect(() => {
    return () => {
      pendingRef.current.forEach((cmd) => {
        clearTimeout(cmd.timeout);
      });
      pendingRef.current.clear();
    };
  }, []);

  return {
    mqttStatus,
    mqttError,
    snapshot,
    fullConfig,
    schedules,
    logs,
    history,
    securityAlert,
    dismissSecurityAlert: useCallback(() => setSecurityAlert(null), []),
    lastSnapshotTime,
    isCommandPending: pendingCommands.size > 0,
    sendCommand,
    requestUpdate,
    getRuntimeState,
    getFullConfig,
    listSchedules,
    setMode,
    setPump,
    setSector,
    getLogs,
    clearLogs,
    setSectorization,
    setSectorEnabled,
    setSectorName,
    setPumpConfig,
    setSystemConfig,
    setRelayConfig,
    setDatetime,
    addSchedule,
    updateSchedule,
    deleteSchedule,
    setScheduleEnabled,
  };
}
