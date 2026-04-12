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

const EMPTY_SNAPSHOT: IrrigationSnapshot = {
  mode: "automatic",
  time_valid: true,
  time_source: "ntp",
  wifi_connected: false,
  mqtt_connected: false,
  wifi_state_text: "",
  wifi_detail: "",
  pump_on: false,
  pump_runtime: null,
  sectorization_enabled: false,
  sectors: [],
  next_event: "",
  next_event_type: "",
  next_event_target: 0,
  next_event_time: "",
  warning: "",
  clock: "",
  fw_version: "",
  sta_ip: "",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasAnyKey(raw: Record<string, unknown>, keys: string[]) {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(raw, key));
}

function normalizeSector(raw: Record<string, unknown>) {
  const index = Number(raw.index ?? raw.id ?? 0);
  return {
    index,
    enabled: Boolean(raw.enabled ?? true),
    name: String(raw.name ?? `Setor ${index}`),
    open: Boolean(raw.open ?? raw.is_open ?? raw.on ?? false),
  };
}

function mergeSectors(
  previous: IrrigationSnapshot["sectors"],
  next: IrrigationSnapshot["sectors"],
): IrrigationSnapshot["sectors"] {
  const merged = new Map<number, IrrigationSnapshot["sectors"][number]>();

  previous.forEach((sector) => {
    merged.set(sector.index, sector);
  });

  next.forEach((sector) => {
    const current = merged.get(sector.index);
    merged.set(sector.index, {
      ...current,
      ...sector,
      name: sector.name || current?.name || `Setor ${sector.index}`,
    });
  });

  return Array.from(merged.values()).sort((a, b) => a.index - b.index);
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

function buildSnapshotPatch(raw: Record<string, unknown>): Partial<IrrigationSnapshot> {
  const patch: Partial<IrrigationSnapshot> = {};

  if (hasAnyKey(raw, ["manual_mode", "manualMode", "mode"])) {
    let mode: "manual" | "automatic" = "automatic";
    if (raw.manual_mode !== undefined) mode = raw.manual_mode ? "manual" : "automatic";
    else if (raw.manualMode !== undefined) mode = raw.manualMode ? "manual" : "automatic";
    else if (raw.mode !== undefined) mode = raw.mode === "manual" ? "manual" : "automatic";
    patch.mode = mode;
  }

  if (hasAnyKey(raw, ["pump_runtime", "pumpRuntime"])) {
    const rawRuntime = asRecord(raw.pump_runtime ?? raw.pumpRuntime);
    patch.pump_runtime = rawRuntime
      ? {
          active: Boolean(rawRuntime.active ?? false),
          mode: String(rawRuntime.mode ?? "idle") as PumpRuntime["mode"],
          seconds: Number(rawRuntime.seconds ?? 0),
          remainingSec: Number(rawRuntime.remainingSec ?? rawRuntime.remaining_sec ?? 0),
          elapsedSec: Number(rawRuntime.elapsedSec ?? rawRuntime.elapsed_sec ?? 0),
        }
      : null;
  }

  if (hasAnyKey(raw, ["time_valid", "timeValid"])) {
    patch.time_valid = Boolean(raw.time_valid ?? raw.timeValid);
  }
  if (hasAnyKey(raw, ["time_source", "timeSource"])) {
    patch.time_source = String(raw.time_source ?? raw.timeSource ?? "ntp");
  }
  if (hasAnyKey(raw, ["wifi_connected", "wifiConnected"])) {
    patch.wifi_connected = Boolean(raw.wifi_connected ?? raw.wifiConnected);
  }
  if (hasAnyKey(raw, ["mqtt_connected", "mqttConnected"])) {
    patch.mqtt_connected = Boolean(raw.mqtt_connected ?? raw.mqttConnected);
  }
  if (hasAnyKey(raw, ["wifiStateText", "wifi_state_text"])) {
    patch.wifi_state_text = String(raw.wifiStateText ?? raw.wifi_state_text ?? "");
  }
  if (hasAnyKey(raw, ["wifiDetail", "wifi_detail"])) {
    patch.wifi_detail = String(raw.wifiDetail ?? raw.wifi_detail ?? "");
  }
  if (hasAnyKey(raw, ["pump_on", "pumpOn"])) {
    patch.pump_on = Boolean(raw.pump_on ?? raw.pumpOn);
  }
  if (hasAnyKey(raw, ["sectorization_enabled", "sectorizationEnabled"])) {
    patch.sectorization_enabled = Boolean(raw.sectorization_enabled ?? raw.sectorizationEnabled);
  }
  if (Array.isArray(raw.sectors)) {
    patch.sectors = (raw.sectors as Array<Record<string, unknown>>).map(normalizeSector);
  }
  if (hasAnyKey(raw, ["next_event"])) {
    patch.next_event = String(raw.next_event ?? "");
  }
  if (hasAnyKey(raw, ["next_event_type"])) {
    patch.next_event_type = String(raw.next_event_type ?? "");
  }
  if (hasAnyKey(raw, ["next_event_target"])) {
    patch.next_event_target = Number(raw.next_event_target ?? 0);
  }
  if (hasAnyKey(raw, ["next_event_time"])) {
    patch.next_event_time = String(raw.next_event_time ?? "");
  }
  if (hasAnyKey(raw, ["overlap_warnings", "overlapWarnings", "warning"])) {
    patch.warning = String(raw.overlap_warnings ?? raw.overlapWarnings ?? raw.warning ?? "");
  }
  if (hasAnyKey(raw, ["clock"])) {
    patch.clock = String(raw.clock ?? "");
  }
  if (hasAnyKey(raw, ["fw_version", "fwVersion"])) {
    patch.fw_version = String(raw.fw_version ?? raw.fwVersion ?? "");
  }
  if (hasAnyKey(raw, ["sta_ip", "staIp"])) {
    patch.sta_ip = String(raw.sta_ip ?? raw.staIp ?? "");
  }

  return patch;
}

function mergeSnapshot(previous: IrrigationSnapshot | null, raw: Record<string, unknown>): IrrigationSnapshot {
  const base = previous ?? EMPTY_SNAPSHOT;
  const patch = buildSnapshotPatch(raw);

  return {
    ...base,
    ...patch,
    sectors: patch.sectors ? mergeSectors(base.sectors, patch.sectors) : base.sectors,
  };
}

function normalizeFullConfig(raw: Record<string, unknown>): IrrigationFullConfig {
  const source = asRecord(raw.data) ?? raw;
  const sectorization = asRecord(source.sectorization);
  const system = asRecord(source.system) ?? asRecord(source.system_config) ?? {};
  const pump = asRecord(source.pump) ?? asRecord(source.pump_config) ?? {};
  const relay = asRecord(source.relay) ?? asRecord(source.relay_config) ?? {};

  const rawSectors = Array.isArray(source.sectors)
    ? source.sectors
    : Array.isArray(sectorization?.sectors)
      ? sectorization.sectors
      : [];

  const publishInterval = source.publish_interval_sec
    ?? source.publishIntervalSec
    ?? system.publish_interval_sec
    ?? system.publishIntervalSec;

  const safetyTime = source.safety_time_sec
    ?? source.safetyTimeSec
    ?? system.safety_time_sec
    ?? system.safetyTimeSec;

  return {
    mode: String(source.mode ?? ((source.manual_mode ?? false) ? "manual" : "automatic")),
    sectorization_enabled: Boolean(
      source.sectorization_enabled
      ?? source.sectorizationEnabled
      ?? sectorization?.enabled
      ?? false,
    ),
    sectors: (rawSectors as Array<Record<string, unknown>>).map((sector) => ({
      index: Number(sector.index ?? 0),
      enabled: Boolean(sector.enabled ?? true),
      name: String(sector.name ?? `Setor ${sector.index ?? 0}`),
    })),
    pump,
    system: {
      ...system,
      ...(publishInterval !== undefined ? { publish_interval_sec: Number(publishInterval) } : {}),
      ...(safetyTime !== undefined ? { safety_time_sec: Number(safetyTime) } : {}),
    },
    relay,
  };
}

function categorizeEvent(text: string): HistoryEvent["category"] {
  const lower = text.toLowerCase();
  if (lower.includes("proteção") || lower.includes("protecao") || lower.includes("segurança") || lower.includes("seguranca")) return "seguranca";
  if (lower.includes("wi-fi") || lower.includes("wifi") || lower.includes("rede") || lower.includes("reconect")) return "conectividade";
  if (lower.includes("mqtt")) return "mqtt";
  if (lower.includes("manual") || lower.includes("manualmente") || lower.includes("pela interface") || lower.includes("botão") || lower.includes("botao")) return "manual";
  if (lower.includes("horário") || lower.includes("horario") || lower.includes("automát") || lower.includes("automat") || lower.includes("agendamento") || lower.includes("schedule") || lower.includes("timer") || lower.includes("programa")) return "automacao";
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

function extractHistoryEntries(raw: Record<string, unknown>): HistoryEvent[] {
  const diagnostics = asRecord(raw.diagnostics);
  const sources = [
    ...(Array.isArray(diagnostics?.history) ? diagnostics.history : []),
    ...(Array.isArray(raw.history) ? raw.history : []),
  ];

  return sources.flatMap((item) => {
    if (typeof item === "string") {
      const category = categorizeEvent(item);
      return [parseHistoryEntry(item, category)];
    }

    const record = asRecord(item);
    const text = String(record?.entry ?? record?.message ?? record?.description ?? "").trim();
    if (!text) return [];

    const category = categorizeEvent(text);
    const parsed = parseHistoryEntry(text, category);
    if (record?.timestamp) {
      parsed.timestamp = String(record.timestamp);
    }
    return [parsed];
  });
}

function buildTransitionEvents(previous: IrrigationSnapshot | null, next: IrrigationSnapshot): Array<Pick<HistoryEvent, "description" | "category">> {
  if (!previous) return [];

  const events: Array<Pick<HistoryEvent, "description" | "category">> = [];
  const category: HistoryEvent["category"] = next.mode === "manual" ? "manual" : "automacao";

  if (previous.pump_on !== next.pump_on) {
    events.push({
      description: next.pump_on
        ? `Bomba ligada ${category === "manual" ? "manualmente" : "pelo horário"}.`
        : `Bomba desligada ${category === "manual" ? "manualmente" : "pelo horário"}.`,
      category,
    });
  }

  if (previous.wifi_connected !== next.wifi_connected) {
    events.push({
      description: next.wifi_connected ? "Wi-Fi conectado no roteador." : "Wi-Fi desconectado do roteador.",
      category: "conectividade",
    });
  }

  if (previous.mqtt_connected !== next.mqtt_connected) {
    events.push({
      description: next.mqtt_connected ? "MQTT conectado e operando normalmente." : "MQTT desconectado.",
      category: "mqtt",
    });
  }

  if (previous.sectorization_enabled !== next.sectorization_enabled) {
    events.push({
      description: `Setorização ${next.sectorization_enabled ? "habilitada" : "desabilitada"}.`,
      category: "sistema",
    });
  }

  const previousSectors = new Map(previous.sectors.map((sector) => [sector.index, sector]));
  next.sectors.forEach((sector) => {
    const previousSector = previousSectors.get(sector.index);
    const name = sector.name || `Setor ${sector.index}`;

    if (previousSector && previousSector.enabled !== sector.enabled) {
      events.push({
        description: `${name} ${sector.enabled ? "habilitado" : "desabilitado"} para irrigação.`,
        category: "sistema",
      });
    }

    if (previousSector && previousSector.open !== sector.open) {
      events.push({
        description: sector.open
          ? `${name} aberto ${category === "manual" ? "manualmente" : "pela automação"}.`
          : `${name} fechado ${category === "manual" ? "manualmente" : "pela automação"}.`,
        category,
      });
    }
  });

  return events;
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
  const snapshotRef = useRef<IrrigationSnapshot | null>(null);

  const addHistoryEvent = useCallback((description: string, category: HistoryEvent["category"]) => {
    const timestamp = new Date().toISOString();

    if (category === "seguranca") {
      setSecurityAlert(description);
    }

    setHistory(prev => {
      const now = Date.now();
      const alreadyExists = prev.some((event) => {
        if (event.description !== description) return false;
        const eventTime = Date.parse(event.timestamp);
        return Number.isFinite(eventTime) && Math.abs(now - eventTime) < 15000;
      });

      if (alreadyExists) return prev;

      const event: HistoryEvent = { timestamp, description, category };
      return [event, ...prev].slice(0, 200);
    });
  }, []);

  const mergeHistoryEntries = useCallback((entries: HistoryEvent[]) => {
    if (entries.length === 0) return;

    const securityEntry = entries.find((entry) => entry.category === "seguranca");
    if (securityEntry) {
      setSecurityAlert(securityEntry.description);
    }

    setHistory((prev) => {
      const seen = new Set<string>();
      const merged: HistoryEvent[] = [];

      [...entries, ...prev].forEach((event) => {
        const key = `${event.timestamp}|${event.description}`;
        if (seen.has(key)) return;
        seen.add(key);
        merged.push(event);
      });

      return merged.slice(0, 200);
    });
  }, []);

  const updateSnapshot = useCallback((raw: Record<string, unknown>) => {
    const previousSnapshot = snapshotRef.current;
    const nextSnapshot = mergeSnapshot(previousSnapshot, raw);

    snapshotRef.current = nextSnapshot;
    setSnapshot(nextSnapshot);
    setLastSnapshotTime(new Date());

    const extractedHistory = extractHistoryEntries(raw);
    if (extractedHistory.length > 0) {
      mergeHistoryEntries([...extractedHistory].reverse());
    }

    buildTransitionEvents(previousSnapshot, nextSnapshot).forEach((event) => {
      addHistoryEvent(event.description, event.category);
    });

    return nextSnapshot;
  }, [addHistoryEvent, mergeHistoryEntries]);

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
      const stateData = asRecord(payload.state);
      if (stateData) {
        updateSnapshot(stateData);
      }

      if (cmd === "list_schedules" && respData?.schedules && Array.isArray(respData.schedules)) {
        setSchedules((respData.schedules as Record<string, unknown>[]).map(normalizeScheduleItem));
      }
      if (cmd === "get_logs" && respData?.logs) {
        setLogs(respData.logs as string[]);
      }
      if (cmd === "get_full_config" && respData) {
        setFullConfig(normalizeFullConfig(respData));
      }
      if (cmd === "get_runtime_state" && respData) {
        updateSnapshot(respData as Record<string, unknown>);
      }

      // Track command as history event
      const msg = String(payload.message || "");
      if (msg) {
        const category = categorizeEvent(msg);
        addHistoryEvent(msg, category);
      }

      return;
    }

    // Data snapshot message (devices/<ID>/data with nested "data" block)
    if (payload.data && typeof payload.data === "object") {
      const data = payload.data as Record<string, unknown>;
      updateSnapshot(data);
      return;
    }

    // Status topic message (devices/<ID>/status with root-level fields)
    // These have pump_on, manual_mode, pump_runtime etc. at the root, no "data" wrapper
    if (message.topic.endsWith("/status") && (payload.status !== undefined || payload.pump_on !== undefined || payload.pump_runtime !== undefined)) {
      updateSnapshot(asRecord(payload.state) ?? payload);
    }
  }, [deviceId, addHistoryEvent, updateSnapshot]);

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

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

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
