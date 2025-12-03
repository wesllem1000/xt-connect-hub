export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      automations: {
        Row: {
          ativo: boolean | null
          configuracao: Json
          created_at: string | null
          descricao: string | null
          dispositivos_ids: string[] | null
          id: string
          nome: string
          updated_at: string | null
          usuario_id: string
        }
        Insert: {
          ativo?: boolean | null
          configuracao: Json
          created_at?: string | null
          descricao?: string | null
          dispositivos_ids?: string[] | null
          id?: string
          nome: string
          updated_at?: string | null
          usuario_id: string
        }
        Update: {
          ativo?: boolean | null
          configuracao?: Json
          created_at?: string | null
          descricao?: string | null
          dispositivos_ids?: string[] | null
          id?: string
          nome?: string
          updated_at?: string | null
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automations_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_types: {
        Row: {
          ativo: boolean | null
          configuracao_padrao: Json | null
          created_at: string | null
          descricao: string | null
          id: string
          nome: string
          tipo: string
          updated_at: string | null
        }
        Insert: {
          ativo?: boolean | null
          configuracao_padrao?: Json | null
          created_at?: string | null
          descricao?: string | null
          id?: string
          nome: string
          tipo: string
          updated_at?: string | null
        }
        Update: {
          ativo?: boolean | null
          configuracao_padrao?: Json | null
          created_at?: string | null
          descricao?: string | null
          id?: string
          nome?: string
          tipo?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      dashboard_components: {
        Row: {
          ativo: boolean | null
          configuracao_padrao: Json | null
          created_at: string | null
          descricao: string | null
          icone: string | null
          id: string
          nome: string
          tipo: Database["public"]["Enums"]["dashboard_component_type"]
          updated_at: string | null
        }
        Insert: {
          ativo?: boolean | null
          configuracao_padrao?: Json | null
          created_at?: string | null
          descricao?: string | null
          icone?: string | null
          id?: string
          nome: string
          tipo: Database["public"]["Enums"]["dashboard_component_type"]
          updated_at?: string | null
        }
        Update: {
          ativo?: boolean | null
          configuracao_padrao?: Json | null
          created_at?: string | null
          descricao?: string | null
          icone?: string | null
          id?: string
          nome?: string
          tipo?: Database["public"]["Enums"]["dashboard_component_type"]
          updated_at?: string | null
        }
        Relationships: []
      }
      device_model_dashboards: {
        Row: {
          ativo: boolean | null
          configuracao: Json | null
          created_at: string | null
          dashboard_component_id: string
          device_model_id: string
          direcao: Database["public"]["Enums"]["data_direction"]
          id: string
          json_path_receive: string | null
          json_path_send: string | null
          mqtt_topic_override: string | null
          ordem: number | null
          updated_at: string | null
        }
        Insert: {
          ativo?: boolean | null
          configuracao?: Json | null
          created_at?: string | null
          dashboard_component_id: string
          device_model_id: string
          direcao?: Database["public"]["Enums"]["data_direction"]
          id?: string
          json_path_receive?: string | null
          json_path_send?: string | null
          mqtt_topic_override?: string | null
          ordem?: number | null
          updated_at?: string | null
        }
        Update: {
          ativo?: boolean | null
          configuracao?: Json | null
          created_at?: string | null
          dashboard_component_id?: string
          device_model_id?: string
          direcao?: Database["public"]["Enums"]["data_direction"]
          id?: string
          json_path_receive?: string | null
          json_path_send?: string | null
          mqtt_topic_override?: string | null
          ordem?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "device_model_dashboards_dashboard_component_id_fkey"
            columns: ["dashboard_component_id"]
            isOneToOne: false
            referencedRelation: "dashboard_components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_model_dashboards_device_model_id_fkey"
            columns: ["device_model_id"]
            isOneToOne: false
            referencedRelation: "device_models"
            referencedColumns: ["id"]
          },
        ]
      }
      device_models: {
        Row: {
          ativo: boolean | null
          created_at: string | null
          descricao: string | null
          especificacoes: Json | null
          fabricante: string
          id: string
          imagem_url: string | null
          nome: string
          protocolos_suportados: string[] | null
          updated_at: string | null
        }
        Insert: {
          ativo?: boolean | null
          created_at?: string | null
          descricao?: string | null
          especificacoes?: Json | null
          fabricante: string
          id?: string
          imagem_url?: string | null
          nome: string
          protocolos_suportados?: string[] | null
          updated_at?: string | null
        }
        Update: {
          ativo?: boolean | null
          created_at?: string | null
          descricao?: string | null
          especificacoes?: Json | null
          fabricante?: string
          id?: string
          imagem_url?: string | null
          nome?: string
          protocolos_suportados?: string[] | null
          updated_at?: string | null
        }
        Relationships: []
      }
      device_shares: {
        Row: {
          created_at: string | null
          device_id: string
          id: string
          shared_by_user_id: string
          shared_with_user_id: string
        }
        Insert: {
          created_at?: string | null
          device_id: string
          id?: string
          shared_by_user_id: string
          shared_with_user_id: string
        }
        Update: {
          created_at?: string | null
          device_id?: string
          id?: string
          shared_by_user_id?: string
          shared_with_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_shares_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          configuracao: Json | null
          created_at: string | null
          device_id: string | null
          device_model_id: string | null
          id: string
          instalador_id: string | null
          localizacao: string | null
          modelo: string | null
          nome: string
          numero_serie: string | null
          owner_id: string | null
          status: Database["public"]["Enums"]["device_status"] | null
          tipo: string
          ultima_conexao: string | null
          updated_at: string | null
          usuario_id: string | null
        }
        Insert: {
          configuracao?: Json | null
          created_at?: string | null
          device_id?: string | null
          device_model_id?: string | null
          id?: string
          instalador_id?: string | null
          localizacao?: string | null
          modelo?: string | null
          nome: string
          numero_serie?: string | null
          owner_id?: string | null
          status?: Database["public"]["Enums"]["device_status"] | null
          tipo: string
          ultima_conexao?: string | null
          updated_at?: string | null
          usuario_id?: string | null
        }
        Update: {
          configuracao?: Json | null
          created_at?: string | null
          device_id?: string | null
          device_model_id?: string | null
          id?: string
          instalador_id?: string | null
          localizacao?: string | null
          modelo?: string | null
          nome?: string
          numero_serie?: string | null
          owner_id?: string | null
          status?: Database["public"]["Enums"]["device_status"] | null
          tipo?: string
          ultima_conexao?: string | null
          updated_at?: string | null
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "devices_device_model_id_fkey"
            columns: ["device_model_id"]
            isOneToOne: false
            referencedRelation: "device_models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devices_instalador_id_fkey"
            columns: ["instalador_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devices_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mqtt_servers: {
        Row: {
          ativo: boolean | null
          created_at: string | null
          descricao: string | null
          host: string
          id: string
          nome: string
          porta: number | null
          senha: string | null
          topico_padrao: string | null
          updated_at: string | null
          usa_ssl: boolean | null
          usuario: string | null
        }
        Insert: {
          ativo?: boolean | null
          created_at?: string | null
          descricao?: string | null
          host: string
          id?: string
          nome: string
          porta?: number | null
          senha?: string | null
          topico_padrao?: string | null
          updated_at?: string | null
          usa_ssl?: boolean | null
          usuario?: string | null
        }
        Update: {
          ativo?: boolean | null
          created_at?: string | null
          descricao?: string | null
          host?: string
          id?: string
          nome?: string
          porta?: number | null
          senha?: string | null
          topico_padrao?: string | null
          updated_at?: string | null
          usa_ssl?: boolean | null
          usuario?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          id: string
          nome_completo: string
          telefone: string | null
          tipo_usuario: Database["public"]["Enums"]["user_type"]
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          id: string
          nome_completo: string
          telefone?: string | null
          tipo_usuario?: Database["public"]["Enums"]["user_type"]
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          id?: string
          nome_completo?: string
          telefone?: string | null
          tipo_usuario?: Database["public"]["Enums"]["user_type"]
          updated_at?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_user_type: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["user_type"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
      dashboard_component_type:
        | "sensor_tensao"
        | "sensor_temperatura"
        | "sensor_umidade"
        | "sensor_corrente"
        | "sensor_generico"
        | "controle_botao"
        | "controle_slider"
        | "controle_switch"
        | "controle_input"
        | "indicador_led"
        | "indicador_status"
        | "indicador_gauge"
      data_direction: "receive" | "send" | "both"
      device_status: "online" | "offline" | "manutencao"
      user_type: "instalador" | "usuario_final"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
      dashboard_component_type: [
        "sensor_tensao",
        "sensor_temperatura",
        "sensor_umidade",
        "sensor_corrente",
        "sensor_generico",
        "controle_botao",
        "controle_slider",
        "controle_switch",
        "controle_input",
        "indicador_led",
        "indicador_status",
        "indicador_gauge",
      ],
      data_direction: ["receive", "send", "both"],
      device_status: ["online", "offline", "manutencao"],
      user_type: ["instalador", "usuario_final"],
    },
  },
} as const
