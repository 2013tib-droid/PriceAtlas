export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string;
          actor_id: string | null;
          after: Json | null;
          before: Json | null;
          created_at: string;
          entity_id: string;
          entity_type: string;
          household_id: string;
          id: number;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          actor_id?: string | null;
          after?: Json | null;
          before?: Json | null;
          created_at?: string;
          entity_id: string;
          entity_type: string;
          household_id: string;
          id?: never;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          after?: Json | null;
          before?: Json | null;
          created_at?: string;
          entity_id?: string;
          entity_type?: string;
          household_id?: string;
          id?: never;
        };
        Relationships: [
          {
            foreignKeyName: "audit_log_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "household";
            referencedColumns: ["id"];
          },
        ];
      };
      barcode_assignment: {
        Row: {
          code: string;
          code_type: string;
          created_at: string;
          household_id: string | null;
          id: string;
          product_id: string;
          store_id: string | null;
          valid_from: string;
          valid_until: string | null;
        };
        ComputedFields: never;
        Insert: {
          code: string;
          code_type: string;
          created_at?: string;
          household_id?: string | null;
          id?: string;
          product_id: string;
          store_id?: string | null;
          valid_from?: string;
          valid_until?: string | null;
        };
        Update: {
          code?: string;
          code_type?: string;
          created_at?: string;
          household_id?: string | null;
          id?: string;
          product_id?: string;
          store_id?: string | null;
          valid_from?: string;
          valid_until?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "barcode_assignment_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "household";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "barcode_assignment_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "product";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "barcode_assignment_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "store";
            referencedColumns: ["id"];
          },
        ];
      };
      branch: {
        Row: {
          address: string | null;
          city: string | null;
          closed_at: string | null;
          created_at: string;
          external_ref: string | null;
          household_id: string | null;
          id: string;
          kind: string;
          name: string;
          region: string | null;
          status: string;
          store_id: string;
          successor_branch_id: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          address?: string | null;
          city?: string | null;
          closed_at?: string | null;
          created_at?: string;
          external_ref?: string | null;
          household_id?: string | null;
          id?: string;
          kind: string;
          name: string;
          region?: string | null;
          status?: string;
          store_id: string;
          successor_branch_id?: string | null;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          city?: string | null;
          closed_at?: string | null;
          created_at?: string;
          external_ref?: string | null;
          household_id?: string | null;
          id?: string;
          kind?: string;
          name?: string;
          region?: string | null;
          status?: string;
          store_id?: string;
          successor_branch_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "branch_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "household";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "branch_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "store";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "branch_successor_branch_id_fkey";
            columns: ["successor_branch_id"];
            isOneToOne: false;
            referencedRelation: "branch";
            referencedColumns: ["id"];
          },
        ];
      };
      brand: {
        Row: {
          created_at: string;
          household_id: string | null;
          id: string;
          merged_into_id: string | null;
          name: string;
          normalized_name: string | null;
          status: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          household_id?: string | null;
          id?: string;
          merged_into_id?: string | null;
          name: string;
          normalized_name?: never;
          status?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          household_id?: string | null;
          id?: string;
          merged_into_id?: string | null;
          name?: string;
          normalized_name?: never;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "brand_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "household";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "brand_merged_into_id_fkey";
            columns: ["merged_into_id"];
            isOneToOne: false;
            referencedRelation: "brand";
            referencedColumns: ["id"];
          },
        ];
      };
      capture: {
        Row: {
          branch_id: string | null;
          captured_at: string | null;
          error_code: string | null;
          error_message: string | null;
          household_id: string;
          id: string;
          kind: string;
          processed_at: string | null;
          shopping_session_id: string | null;
          status: string;
          store_id: string | null;
          uploaded_at: string;
          uploaded_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          branch_id?: string | null;
          captured_at?: string | null;
          error_code?: string | null;
          error_message?: string | null;
          household_id: string;
          id?: string;
          kind: string;
          processed_at?: string | null;
          shopping_session_id?: string | null;
          status?: string;
          store_id?: string | null;
          uploaded_at?: string;
          uploaded_by?: string | null;
        };
        Update: {
          branch_id?: string | null;
          captured_at?: string | null;
          error_code?: string | null;
          error_message?: string | null;
          household_id?: string;
          id?: string;
          kind?: string;
          processed_at?: string | null;
          shopping_session_id?: string | null;
          status?: string;
          store_id?: string | null;
          uploaded_at?: string;
          uploaded_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "capture_branch_id_store_id_fkey";
            columns: ["branch_id", "store_id"];
            isOneToOne: false;
            referencedRelation: "branch";
            referencedColumns: ["id", "store_id"];
          },
          {
            foreignKeyName: "capture_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "household";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "capture_shopping_session_id_household_id_fkey";
            columns: ["shopping_session_id", "household_id"];
            isOneToOne: false;
            referencedRelation: "shopping_session";
            referencedColumns: ["id", "household_id"];
          },
          {
            foreignKeyName: "capture_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "store";
            referencedColumns: ["id"];
          },
        ];
      };
      capture_image: {
        Row: {
          byte_size: number | null;
          capture_id: string;
          created_at: string;
          household_id: string;
          id: string;
          position: number;
          purge_after: string;
          purged_at: string | null;
          sha256: string;
          storage_path: string;
        };
        ComputedFields: never;
        Insert: {
          byte_size?: number | null;
          capture_id: string;
          created_at?: string;
          household_id: string;
          id?: string;
          position: number;
          purge_after?: string;
          purged_at?: string | null;
          sha256: string;
          storage_path: string;
        };
        Update: {
          byte_size?: number | null;
          capture_id?: string;
          created_at?: string;
          household_id?: string;
          id?: string;
          position?: number;
          purge_after?: string;
          purged_at?: string | null;
          sha256?: string;
          storage_path?: string;
        };
        Relationships: [
          {
            foreignKeyName: "capture_image_capture_id_household_id_fkey";
            columns: ["capture_id", "household_id"];
            isOneToOne: false;
            referencedRelation: "capture";
            referencedColumns: ["id", "household_id"];
          },
        ];
      };
      capture_item: {
        Row: {
          branch_id: string | null;
          candidate_product_ids: string[];
          capture_id: string;
          created_at: string;
          currency: string;
          decided_at: string | null;
          decided_by: string | null;
          extra: NonNullable<Json>;
          field_confidence: NonNullable<Json>;
          household_id: string;
          id: string;
          image_position: number | null;
          is_bundle: boolean;
          match_confidence: number | null;
          match_tier: string | null;
          member_price: number | null;
          member_program_id: string | null;
          normal_price: number | null;
          position: number;
          price_record_id: string | null;
          promo_min_qty: number | null;
          promo_price: number | null;
          promo_valid_from: string | null;
          promo_valid_until: string | null;
          raw_text: string;
          read_member_price: number | null;
          read_member_program_name: string | null;
          region: Json | null;
          seller_name: string | null;
          seller_ref: string | null;
          status: string;
          store_id: string | null;
          suggested_product_id: string | null;
          transaction_date: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          branch_id?: string | null;
          candidate_product_ids?: string[];
          capture_id: string;
          created_at?: string;
          currency?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          extra?: NonNullable<Json>;
          field_confidence?: NonNullable<Json>;
          household_id: string;
          id?: string;
          image_position?: number | null;
          is_bundle?: boolean;
          match_confidence?: number | null;
          match_tier?: string | null;
          member_price?: number | null;
          member_program_id?: string | null;
          normal_price?: number | null;
          position: number;
          price_record_id?: string | null;
          promo_min_qty?: number | null;
          promo_price?: number | null;
          promo_valid_from?: string | null;
          promo_valid_until?: string | null;
          raw_text: string;
          read_member_price?: number | null;
          read_member_program_name?: string | null;
          region?: Json | null;
          seller_name?: string | null;
          seller_ref?: string | null;
          status?: string;
          store_id?: string | null;
          suggested_product_id?: string | null;
          transaction_date: string;
          updated_at?: string;
        };
        Update: {
          branch_id?: string | null;
          candidate_product_ids?: string[];
          capture_id?: string;
          created_at?: string;
          currency?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          extra?: NonNullable<Json>;
          field_confidence?: NonNullable<Json>;
          household_id?: string;
          id?: string;
          image_position?: number | null;
          is_bundle?: boolean;
          match_confidence?: number | null;
          match_tier?: string | null;
          member_price?: number | null;
          member_program_id?: string | null;
          normal_price?: number | null;
          position?: number;
          price_record_id?: string | null;
          promo_min_qty?: number | null;
          promo_price?: number | null;
          promo_valid_from?: string | null;
          promo_valid_until?: string | null;
          raw_text?: string;
          read_member_price?: number | null;
          read_member_program_name?: string | null;
          region?: Json | null;
          seller_name?: string | null;
          seller_ref?: string | null;
          status?: string;
          store_id?: string | null;
          suggested_product_id?: string | null;
          transaction_date?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "capture_item_branch_id_store_id_fkey";
            columns: ["branch_id", "store_id"];
            isOneToOne: false;
            referencedRelation: "branch";
            referencedColumns: ["id", "store_id"];
          },
          {
            foreignKeyName: "capture_item_capture_id_household_id_fkey";
            columns: ["capture_id", "household_id"];
            isOneToOne: false;
            referencedRelation: "capture";
            referencedColumns: ["id", "household_id"];
          },
          {
            foreignKeyName: "capture_item_member_program_id_fkey";
            columns: ["member_program_id"];
            isOneToOne: false;
            referencedRelation: "member_program";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "capture_item_price_record_id_fkey";
            columns: ["price_record_id"];
            isOneToOne: true;
            referencedRelation: "price_record";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "capture_item_price_record_id_fkey";
            columns: ["price_record_id"];
            isOneToOne: true;
            referencedRelation: "price_record_view";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "capture_item_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "store";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "capture_item_suggested_product_id_fkey";
            columns: ["suggested_product_id"];
            isOneToOne: false;
            referencedRelation: "product";
            referencedColumns: ["id"];
          },
        ];
      };
      category: {
        Row: {
          archived_at: string | null;
          created_at: string;
          household_id: string | null;
          id: string;
          name: string;
          parent_id: string | null;
          slug: string | null;
        };
        ComputedFields: never;
        Insert: {
          archived_at?: string | null;
          created_at?: string;
          household_id?: string | null;
          id?: string;
          name: string;
          parent_id?: string | null;
          slug?: string | null;
        };
        Update: {
          archived_at?: string | null;
          created_at?: string;
          household_id?: string | null;
          id?: string;
          name?: string;
          parent_id?: string | null;
          slug?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "category_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "household";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "category_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "category";
            referencedColumns: ["id"];
          },
        ];
      };
      household: {
        Row: {
          archived_at: string | null;
          created_at: string;
          default_currency: string;
          id: string;
          name: string;
          share_prices_public: boolean;
          timezone: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          archived_at?: string | null;
          created_at?: string;
          default_currency?: string;
          id?: string;
          name: string;
          share_prices_public?: boolean;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          created_at?: string;
          default_currency?: string;
          id?: string;
          name?: string;
          share_prices_public?: boolean;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      household_member: {
        Row: {
          household_id: string;
          joined_at: string;
          role: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          household_id: string;
          joined_at?: string;
          role?: string;
          user_id: string;
        };
        Update: {
          household_id?: string;
          joined_at?: string;
          role?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "household_member_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "household";
            referencedColumns: ["id"];
          },
        ];
      };
      household_program_membership: {
        Row: {
          created_at: string;
          household_id: string;
          member_program_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          household_id: string;
          member_program_id: string;
        };
        Update: {
          created_at?: string;
          household_id?: string;
          member_program_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "household_program_membership_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "household";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "household_program_membership_member_program_id_fkey";
            columns: ["member_program_id"];
            isOneToOne: false;
            referencedRelation: "member_program";
            referencedColumns: ["id"];
          },
        ];
      };
      member_program: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          status: string;
          store_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          status?: string;
          store_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          status?: string;
          store_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "member_program_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "store";
            referencedColumns: ["id"];
          },
        ];
      };
      price_record: {
        Row: {
          actual_weight: number | null;
          branch_id: string | null;
          capture_id: string | null;
          created_at: string;
          created_by: string | null;
          currency: string;
          effective_price: number;
          extra: NonNullable<Json>;
          household_id: string;
          id: string;
          is_bundle: boolean;
          match_confidence: number | null;
          match_outcome: string | null;
          match_tier: string | null;
          member_price: number | null;
          member_program_id: string | null;
          normal_price: number | null;
          price_basis: string;
          product_id: string;
          promo_min_qty: number | null;
          promo_price: number | null;
          promo_valid_from: string | null;
          promo_valid_until: string | null;
          quantity: number;
          receipt_line_id: string | null;
          source_type: string;
          status: string;
          store_id: string;
          transaction_date: string;
          unit_price: number;
          updated_at: string;
          visibility: string;
        };
        ComputedFields: never;
        Insert: {
          actual_weight?: number | null;
          branch_id?: string | null;
          capture_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          effective_price: number;
          extra?: NonNullable<Json>;
          household_id: string;
          id?: string;
          is_bundle?: boolean;
          match_confidence?: number | null;
          match_outcome?: string | null;
          match_tier?: string | null;
          member_price?: number | null;
          member_program_id?: string | null;
          normal_price?: number | null;
          price_basis: string;
          product_id: string;
          promo_min_qty?: number | null;
          promo_price?: number | null;
          promo_valid_from?: string | null;
          promo_valid_until?: string | null;
          quantity?: number;
          receipt_line_id?: string | null;
          source_type: string;
          status?: string;
          store_id: string;
          transaction_date: string;
          unit_price: number;
          updated_at?: string;
          visibility?: string;
        };
        Update: {
          actual_weight?: number | null;
          branch_id?: string | null;
          capture_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          effective_price?: number;
          extra?: NonNullable<Json>;
          household_id?: string;
          id?: string;
          is_bundle?: boolean;
          match_confidence?: number | null;
          match_outcome?: string | null;
          match_tier?: string | null;
          member_price?: number | null;
          member_program_id?: string | null;
          normal_price?: number | null;
          price_basis?: string;
          product_id?: string;
          promo_min_qty?: number | null;
          promo_price?: number | null;
          promo_valid_from?: string | null;
          promo_valid_until?: string | null;
          quantity?: number;
          receipt_line_id?: string | null;
          source_type?: string;
          status?: string;
          store_id?: string;
          transaction_date?: string;
          unit_price?: number;
          updated_at?: string;
          visibility?: string;
        };
        Relationships: [
          {
            foreignKeyName: "price_record_branch_id_store_id_fkey";
            columns: ["branch_id", "store_id"];
            isOneToOne: false;
            referencedRelation: "branch";
            referencedColumns: ["id", "store_id"];
          },
          {
            foreignKeyName: "price_record_capture_id_household_id_fkey";
            columns: ["capture_id", "household_id"];
            isOneToOne: false;
            referencedRelation: "capture";
            referencedColumns: ["id", "household_id"];
          },
          {
            foreignKeyName: "price_record_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "household";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "price_record_member_program_id_fkey";
            columns: ["member_program_id"];
            isOneToOne: false;
            referencedRelation: "member_program";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "price_record_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "product";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "price_record_receipt_line_id_household_id_fkey";
            columns: ["receipt_line_id", "household_id"];
            isOneToOne: false;
            referencedRelation: "receipt_line";
            referencedColumns: ["id", "household_id"];
          },
          {
            foreignKeyName: "price_record_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "store";
            referencedColumns: ["id"];
          },
        ];
      };
      price_summary: {
        Row: {
          as_of_date: string;
          best_90d_branch_id: string | null;
          best_90d_date: string | null;
          best_90d_effective_price: number | null;
          best_90d_price_basis: string | null;
          best_90d_record_id: string | null;
          best_90d_store_id: string | null;
          best_90d_unit_price: number | null;
          best_all_branch_id: string | null;
          best_all_date: string;
          best_all_effective_price: number;
          best_all_price_basis: string;
          best_all_record_id: string;
          best_all_store_id: string;
          best_all_unit_price: number;
          household_id: string;
          last_effective_price: number;
          last_transaction_date: string;
          last_unit_price: number;
          product_id: string;
          record_count: number;
          refreshed_at: string;
          trend_direction: string | null;
          trend_pct: number | null;
        };
        ComputedFields: never;
        Insert: {
          as_of_date: string;
          best_90d_branch_id?: string | null;
          best_90d_date?: string | null;
          best_90d_effective_price?: number | null;
          best_90d_price_basis?: string | null;
          best_90d_record_id?: string | null;
          best_90d_store_id?: string | null;
          best_90d_unit_price?: number | null;
          best_all_branch_id?: string | null;
          best_all_date: string;
          best_all_effective_price: number;
          best_all_price_basis: string;
          best_all_record_id: string;
          best_all_store_id: string;
          best_all_unit_price: number;
          household_id: string;
          last_effective_price: number;
          last_transaction_date: string;
          last_unit_price: number;
          product_id: string;
          record_count: number;
          refreshed_at?: string;
          trend_direction?: string | null;
          trend_pct?: number | null;
        };
        Update: {
          as_of_date?: string;
          best_90d_branch_id?: string | null;
          best_90d_date?: string | null;
          best_90d_effective_price?: number | null;
          best_90d_price_basis?: string | null;
          best_90d_record_id?: string | null;
          best_90d_store_id?: string | null;
          best_90d_unit_price?: number | null;
          best_all_branch_id?: string | null;
          best_all_date?: string;
          best_all_effective_price?: number;
          best_all_price_basis?: string;
          best_all_record_id?: string;
          best_all_store_id?: string;
          best_all_unit_price?: number;
          household_id?: string;
          last_effective_price?: number;
          last_transaction_date?: string;
          last_unit_price?: number;
          product_id?: string;
          record_count?: number;
          refreshed_at?: string;
          trend_direction?: string | null;
          trend_pct?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "price_summary_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "household";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "price_summary_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "product";
            referencedColumns: ["id"];
          },
        ];
      };
      processing_run: {
        Row: {
          ai_model: string | null;
          capture_id: string;
          cost_usd: number | null;
          error_message: string | null;
          finished_at: string | null;
          household_id: string;
          id: string;
          input_tokens: number | null;
          ocr_engine: string | null;
          output_tokens: number | null;
          pii_redacted_at: string | null;
          prompt_version: string | null;
          raw_ai_output: Json | null;
          raw_ocr_text: string | null;
          started_at: string;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          ai_model?: string | null;
          capture_id: string;
          cost_usd?: number | null;
          error_message?: string | null;
          finished_at?: string | null;
          household_id: string;
          id?: string;
          input_tokens?: number | null;
          ocr_engine?: string | null;
          output_tokens?: number | null;
          pii_redacted_at?: string | null;
          prompt_version?: string | null;
          raw_ai_output?: Json | null;
          raw_ocr_text?: string | null;
          started_at?: string;
          status?: string;
        };
        Update: {
          ai_model?: string | null;
          capture_id?: string;
          cost_usd?: number | null;
          error_message?: string | null;
          finished_at?: string | null;
          household_id?: string;
          id?: string;
          input_tokens?: number | null;
          ocr_engine?: string | null;
          output_tokens?: number | null;
          pii_redacted_at?: string | null;
          prompt_version?: string | null;
          raw_ai_output?: Json | null;
          raw_ocr_text?: string | null;
          started_at?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "processing_run_capture_id_household_id_fkey";
            columns: ["capture_id", "household_id"];
            isOneToOne: false;
            referencedRelation: "capture";
            referencedColumns: ["id", "household_id"];
          },
        ];
      };
      product: {
        Row: {
          brand_id: string | null;
          category_id: string | null;
          content_size: number | null;
          content_unit: string;
          created_at: string;
          household_id: string | null;
          id: string;
          merged_into_id: string | null;
          name: string;
          pack_count: number;
          product_group_id: string | null;
          sale_mode: string;
          search_text: string | null;
          status: string;
          updated_at: string;
          variant: string | null;
        };
        ComputedFields: never;
        Insert: {
          brand_id?: string | null;
          category_id?: string | null;
          content_size?: number | null;
          content_unit: string;
          created_at?: string;
          household_id?: string | null;
          id?: string;
          merged_into_id?: string | null;
          name: string;
          pack_count?: number;
          product_group_id?: string | null;
          sale_mode?: string;
          search_text?: never;
          status?: string;
          updated_at?: string;
          variant?: string | null;
        };
        Update: {
          brand_id?: string | null;
          category_id?: string | null;
          content_size?: number | null;
          content_unit?: string;
          created_at?: string;
          household_id?: string | null;
          id?: string;
          merged_into_id?: string | null;
          name?: string;
          pack_count?: number;
          product_group_id?: string | null;
          sale_mode?: string;
          search_text?: never;
          status?: string;
          updated_at?: string;
          variant?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "product_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brand";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "category";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_content_unit_fkey";
            columns: ["content_unit"];
            isOneToOne: false;
            referencedRelation: "unit";
            referencedColumns: ["code"];
          },
          {
            foreignKeyName: "product_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "household";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_merged_into_id_fkey";
            columns: ["merged_into_id"];
            isOneToOne: false;
            referencedRelation: "product";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_product_group_id_fkey";
            columns: ["product_group_id"];
            isOneToOne: false;
            referencedRelation: "product_group";
            referencedColumns: ["id"];
          },
        ];
      };
      product_alias: {
        Row: {
          alias_text: string;
          created_at: string;
          household_id: string | null;
          id: string;
          normalized_text: string | null;
          product_id: string;
          promoted_at: string | null;
          status: string;
          store_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          alias_text: string;
          created_at?: string;
          household_id?: string | null;
          id?: string;
          normalized_text?: never;
          product_id: string;
          promoted_at?: string | null;
          status?: string;
          store_id: string;
          updated_at?: string;
        };
        Update: {
          alias_text?: string;
          created_at?: string;
          household_id?: string | null;
          id?: string;
          normalized_text?: never;
          product_id?: string;
          promoted_at?: string | null;
          status?: string;
          store_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_alias_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "household";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_alias_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "product";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_alias_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "store";
            referencedColumns: ["id"];
          },
        ];
      };
      product_group: {
        Row: {
          brand_id: string | null;
          category_id: string | null;
          created_at: string;
          household_id: string | null;
          id: string;
          merged_into_id: string | null;
          name: string;
          normalized_name: string | null;
          status: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          brand_id?: string | null;
          category_id?: string | null;
          created_at?: string;
          household_id?: string | null;
          id?: string;
          merged_into_id?: string | null;
          name: string;
          normalized_name?: never;
          status?: string;
          updated_at?: string;
        };
        Update: {
          brand_id?: string | null;
          category_id?: string | null;
          created_at?: string;
          household_id?: string | null;
          id?: string;
          merged_into_id?: string | null;
          name?: string;
          normalized_name?: never;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_group_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brand";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_group_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "category";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_group_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "household";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_group_merged_into_id_fkey";
            columns: ["merged_into_id"];
            isOneToOne: false;
            referencedRelation: "product_group";
            referencedColumns: ["id"];
          },
        ];
      };
      profile: {
        Row: {
          created_at: string;
          display_name: string | null;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          display_name?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          display_name?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      public_price_fact: {
        Row: {
          branch_id: string | null;
          currency: string;
          effective_price: number;
          id: string;
          price_basis: string;
          product_id: string;
          source_type: string;
          store_id: string;
          transaction_date: string;
          unit_price: number;
        };
        ComputedFields: never;
        Insert: {
          branch_id?: string | null;
          currency: string;
          effective_price: number;
          id?: string;
          price_basis: string;
          product_id: string;
          source_type: string;
          store_id: string;
          transaction_date: string;
          unit_price: number;
        };
        Update: {
          branch_id?: string | null;
          currency?: string;
          effective_price?: number;
          id?: string;
          price_basis?: string;
          product_id?: string;
          source_type?: string;
          store_id?: string;
          transaction_date?: string;
          unit_price?: number;
        };
        Relationships: [
          {
            foreignKeyName: "public_price_fact_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branch";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "public_price_fact_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "product";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "public_price_fact_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "store";
            referencedColumns: ["id"];
          },
        ];
      };
      receipt: {
        Row: {
          branch_id: string | null;
          capture_id: string | null;
          confirmed_at: string | null;
          created_at: string;
          currency: string;
          duplicate_of_receipt_id: string | null;
          field_confidence: NonNullable<Json>;
          household_id: string;
          id: string;
          payment_method: string | null;
          pii: NonNullable<Json>;
          status: string;
          store_id: string | null;
          subtotal_amount: number | null;
          total_amount: number;
          transaction_date: string;
          transaction_time: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          branch_id?: string | null;
          capture_id?: string | null;
          confirmed_at?: string | null;
          created_at?: string;
          currency?: string;
          duplicate_of_receipt_id?: string | null;
          field_confidence?: NonNullable<Json>;
          household_id: string;
          id?: string;
          payment_method?: string | null;
          pii?: NonNullable<Json>;
          status?: string;
          store_id?: string | null;
          subtotal_amount?: number | null;
          total_amount: number;
          transaction_date: string;
          transaction_time?: string | null;
          updated_at?: string;
        };
        Update: {
          branch_id?: string | null;
          capture_id?: string | null;
          confirmed_at?: string | null;
          created_at?: string;
          currency?: string;
          duplicate_of_receipt_id?: string | null;
          field_confidence?: NonNullable<Json>;
          household_id?: string;
          id?: string;
          payment_method?: string | null;
          pii?: NonNullable<Json>;
          status?: string;
          store_id?: string | null;
          subtotal_amount?: number | null;
          total_amount?: number;
          transaction_date?: string;
          transaction_time?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "receipt_branch_id_store_id_fkey";
            columns: ["branch_id", "store_id"];
            isOneToOne: false;
            referencedRelation: "branch";
            referencedColumns: ["id", "store_id"];
          },
          {
            foreignKeyName: "receipt_capture_id_household_id_fkey";
            columns: ["capture_id", "household_id"];
            isOneToOne: false;
            referencedRelation: "capture";
            referencedColumns: ["id", "household_id"];
          },
          {
            foreignKeyName: "receipt_duplicate_of_receipt_id_household_id_fkey";
            columns: ["duplicate_of_receipt_id", "household_id"];
            isOneToOne: false;
            referencedRelation: "receipt";
            referencedColumns: ["id", "household_id"];
          },
          {
            foreignKeyName: "receipt_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "household";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "receipt_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "store";
            referencedColumns: ["id"];
          },
        ];
      };
      receipt_adjustment: {
        Row: {
          amount: number | null;
          created_at: string;
          description: string | null;
          household_id: string;
          id: string;
          kind: string;
          points: number | null;
          receipt_id: string;
        };
        ComputedFields: never;
        Insert: {
          amount?: number | null;
          created_at?: string;
          description?: string | null;
          household_id: string;
          id?: string;
          kind: string;
          points?: number | null;
          receipt_id: string;
        };
        Update: {
          amount?: number | null;
          created_at?: string;
          description?: string | null;
          household_id?: string;
          id?: string;
          kind?: string;
          points?: number | null;
          receipt_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "receipt_adjustment_receipt_id_household_id_fkey";
            columns: ["receipt_id", "household_id"];
            isOneToOne: false;
            referencedRelation: "receipt";
            referencedColumns: ["id", "household_id"];
          },
        ];
      };
      receipt_line: {
        Row: {
          applies_to_line_id: string | null;
          created_at: string;
          household_id: string;
          id: string;
          line_amount: number;
          line_no: number;
          line_type: string;
          match_confidence: number | null;
          match_tier: string | null;
          quantity: number | null;
          raw_text: string;
          receipt_id: string;
          suggested_product_id: string | null;
          unit_amount: number | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          applies_to_line_id?: string | null;
          created_at?: string;
          household_id: string;
          id?: string;
          line_amount: number;
          line_no: number;
          line_type: string;
          match_confidence?: number | null;
          match_tier?: string | null;
          quantity?: number | null;
          raw_text: string;
          receipt_id: string;
          suggested_product_id?: string | null;
          unit_amount?: number | null;
          updated_at?: string;
        };
        Update: {
          applies_to_line_id?: string | null;
          created_at?: string;
          household_id?: string;
          id?: string;
          line_amount?: number;
          line_no?: number;
          line_type?: string;
          match_confidence?: number | null;
          match_tier?: string | null;
          quantity?: number | null;
          raw_text?: string;
          receipt_id?: string;
          suggested_product_id?: string | null;
          unit_amount?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "receipt_line_applies_to_line_id_receipt_id_fkey";
            columns: ["applies_to_line_id", "receipt_id"];
            isOneToOne: false;
            referencedRelation: "receipt_line";
            referencedColumns: ["id", "receipt_id"];
          },
          {
            foreignKeyName: "receipt_line_receipt_id_household_id_fkey";
            columns: ["receipt_id", "household_id"];
            isOneToOne: false;
            referencedRelation: "receipt";
            referencedColumns: ["id", "household_id"];
          },
          {
            foreignKeyName: "receipt_line_suggested_product_id_fkey";
            columns: ["suggested_product_id"];
            isOneToOne: false;
            referencedRelation: "product";
            referencedColumns: ["id"];
          },
        ];
      };
      shopping_session: {
        Row: {
          branch_id: string;
          ended_at: string | null;
          expires_at: string;
          household_id: string;
          id: string;
          started_at: string;
          started_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          branch_id: string;
          ended_at?: string | null;
          expires_at?: string;
          household_id: string;
          id?: string;
          started_at?: string;
          started_by?: string | null;
        };
        Update: {
          branch_id?: string;
          ended_at?: string | null;
          expires_at?: string;
          household_id?: string;
          id?: string;
          started_at?: string;
          started_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "shopping_session_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branch";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shopping_session_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "household";
            referencedColumns: ["id"];
          },
        ];
      };
      store: {
        Row: {
          channel: string;
          created_at: string;
          household_id: string | null;
          id: string;
          name: string;
          normalized_name: string | null;
          status: string;
          store_group_id: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          channel: string;
          created_at?: string;
          household_id?: string | null;
          id?: string;
          name: string;
          normalized_name?: never;
          status?: string;
          store_group_id?: string | null;
          updated_at?: string;
        };
        Update: {
          channel?: string;
          created_at?: string;
          household_id?: string | null;
          id?: string;
          name?: string;
          normalized_name?: never;
          status?: string;
          store_group_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "store_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "household";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "store_store_group_id_fkey";
            columns: ["store_group_id"];
            isOneToOne: false;
            referencedRelation: "store_group";
            referencedColumns: ["id"];
          },
        ];
      };
      store_group: {
        Row: {
          created_at: string;
          id: string;
          name: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
        };
        Relationships: [];
      };
      unit: {
        Row: {
          code: string;
          dimension: string;
          name: string;
          to_base_factor: number;
        };
        ComputedFields: never;
        Insert: {
          code: string;
          dimension: string;
          name: string;
          to_base_factor: number;
        };
        Update: {
          code?: string;
          dimension?: string;
          name?: string;
          to_base_factor?: number;
        };
        Relationships: [];
      };
    };
    Views: {
      price_record_view: {
        Row: {
          actual_weight: number | null;
          branch_id: string | null;
          branch_name: string | null;
          branch_status: string | null;
          capture_id: string | null;
          created_at: string | null;
          created_by: string | null;
          currency: string | null;
          effective_price: number | null;
          extra: Json | null;
          household_id: string | null;
          id: string | null;
          is_bundle: boolean | null;
          match_confidence: number | null;
          match_outcome: string | null;
          match_tier: string | null;
          member_not_counted: boolean | null;
          member_price: number | null;
          member_program_id: string | null;
          member_program_name: string | null;
          normal_price: number | null;
          normal_unit_price: number | null;
          price_basis: string | null;
          product_id: string | null;
          promo_min_qty: number | null;
          promo_price: number | null;
          promo_valid_from: string | null;
          promo_valid_until: string | null;
          quantity: number | null;
          receipt_id: string | null;
          receipt_line_id: string | null;
          source_type: string | null;
          status: string | null;
          store_channel: string | null;
          store_id: string | null;
          store_name: string | null;
          transaction_date: string | null;
          unit_price: number | null;
          updated_at: string | null;
          visibility: string | null;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "price_record_branch_id_store_id_fkey";
            columns: ["branch_id", "store_id"];
            isOneToOne: false;
            referencedRelation: "branch";
            referencedColumns: ["id", "store_id"];
          },
          {
            foreignKeyName: "price_record_capture_id_household_id_fkey";
            columns: ["capture_id", "household_id"];
            isOneToOne: false;
            referencedRelation: "capture";
            referencedColumns: ["id", "household_id"];
          },
          {
            foreignKeyName: "price_record_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "household";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "price_record_member_program_id_fkey";
            columns: ["member_program_id"];
            isOneToOne: false;
            referencedRelation: "member_program";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "price_record_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "product";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "price_record_receipt_line_id_household_id_fkey";
            columns: ["receipt_line_id", "household_id"];
            isOneToOne: false;
            referencedRelation: "receipt_line";
            referencedColumns: ["id", "household_id"];
          },
          {
            foreignKeyName: "price_record_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "store";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Functions: {
      begin_account_deletion: { Args: { p_user_id: string }; Returns: Json };
      begin_ask: { Args: Record<PropertyKey, never>; Returns: Json };
      compare_sizes: {
        Args: { p_group_id: string; p_window?: string };
        Returns: Json[];
      };
      confirm_capture_items: {
        Args: { p_capture_id: string; p_items: Json };
        Returns: Json;
      };
      confirm_receipt: {
        Args: {
          p_duplicate_decision?: string;
          p_lines: Json;
          p_receipt_id: string;
        };
        Returns: Json;
      };
      correct_price_record: {
        Args: {
          p_expected_updated_at: string;
          p_id: string;
          p_patch: Json;
          p_update_alias?: boolean;
        };
        Returns: Json;
      };
      correct_receipt_line: {
        Args: {
          p_expected_updated_at: string;
          p_line_id: string;
          p_patch: Json;
        };
        Returns: Json;
      };
      create_private_branch: { Args: { p_branch: Json }; Returns: Json };
      create_private_product: { Args: { p_product: Json }; Returns: Json };
      create_private_store: { Args: { p_store: Json }; Returns: Json };
      delete_capture: { Args: { p_capture_id: string }; Returns: Json };
      end_shopping_session: { Args: { p_session_id: string }; Returns: Json };
      extend_shopping_session: {
        Args: { p_session_id: string };
        Returns: Json;
      };
      find_product_by_barcode: {
        Args: { p_code: string; p_store_id?: string };
        Returns: Json;
      };
      get_active_session: { Args: Record<PropertyKey, never>; Returns: Json };
      get_capture: { Args: { p_capture_id: string }; Returns: Json };
      get_capture_items: { Args: { p_capture_id: string }; Returns: Json[] };
      get_client_config: { Args: Record<PropertyKey, never>; Returns: Json };
      get_my_context: { Args: Record<PropertyKey, never>; Returns: Json };
      get_my_programs: { Args: Record<PropertyKey, never>; Returns: Json[] };
      get_offline_cache: {
        Args: { p_top?: number; p_viewed_ids?: string[] };
        Returns: Json[];
      };
      get_product_cards: { Args: { p_ids: string[] }; Returns: Json[] };
      get_product_detail: { Args: { p_product_id: string }; Returns: Json };
      get_receipt: { Args: { p_receipt_id: string }; Returns: Json };
      list_captures: {
        Args: { p_before?: string; p_kind?: string; p_limit?: number };
        Returns: Json[];
      };
      merge_product: {
        Args: { p_from: string; p_into: string };
        Returns: undefined;
      };
      merge_product_preview: {
        Args: { p_from: string; p_into: string };
        Returns: Json;
      };
      move_price_records: {
        Args: {
          p_alias?: Json;
          p_record_ids: string[];
          p_target_product_id: string;
        };
        Returns: Json;
      };
      price_chart: {
        Args: { p_normal_only?: boolean; p_product_id: string };
        Returns: {
          date: string;
          price_basis: string;
          record_id: string;
          unit_price: number;
        }[];
      };
      price_history: {
        Args: {
          p_before_date?: string;
          p_before_id?: string;
          p_include_void?: boolean;
          p_limit?: number;
          p_product_id: string;
          p_store_id?: string;
        };
        Returns: {
          actual_weight: number | null;
          branch_id: string | null;
          branch_name: string | null;
          branch_status: string | null;
          capture_id: string | null;
          created_at: string | null;
          created_by: string | null;
          currency: string | null;
          effective_price: number | null;
          extra: Json | null;
          household_id: string | null;
          id: string | null;
          is_bundle: boolean | null;
          match_confidence: number | null;
          match_outcome: string | null;
          match_tier: string | null;
          member_not_counted: boolean | null;
          member_price: number | null;
          member_program_id: string | null;
          member_program_name: string | null;
          normal_price: number | null;
          normal_unit_price: number | null;
          price_basis: string | null;
          product_id: string | null;
          promo_min_qty: number | null;
          promo_price: number | null;
          promo_valid_from: string | null;
          promo_valid_until: string | null;
          quantity: number | null;
          receipt_id: string | null;
          receipt_line_id: string | null;
          source_type: string | null;
          status: string | null;
          store_channel: string | null;
          store_id: string | null;
          store_name: string | null;
          transaction_date: string | null;
          unit_price: number | null;
          updated_at: string | null;
          visibility: string | null;
        }[];
        SetofOptions: {
          from: "*";
          to: "price_record_view";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      price_record_detail: { Args: { p_id: string }; Returns: Json };
      price_trend: {
        Args: { p_normal_only?: boolean; p_product_id: string };
        Returns: Json;
      };
      recent_locations: { Args: { p_limit?: number }; Returns: Json[] };
      record_ask_usage: {
        Args: {
          p_cost_usd?: number;
          p_day: string;
          p_input_tokens: number;
          p_output_tokens: number;
        };
        Returns: undefined;
      };
      retry_capture: { Args: { p_capture_id: string }; Returns: Json };
      search_products: {
        Args: { p_limit?: number; p_query: string };
        Returns: Json[];
      };
      set_program_membership: {
        Args: { p_member: boolean; p_program_id: string };
        Returns: Json;
      };
      set_share_prices_public: { Args: { p_enabled: boolean }; Returns: Json };
      share_existing_prices: {
        Args: Record<PropertyKey, never>;
        Returns: Json;
      };
      start_shopping_session: {
        Args: { p_branch_id: string; p_session_id: string };
        Returns: Json;
      };
      submit_capture: {
        Args: {
          p_branch_id?: string;
          p_capture_id: string;
          p_captured_at?: string;
          p_images: Json;
          p_kind: string;
          p_shopping_session_id?: string;
          p_store_id?: string;
        };
        Returns: Json;
      };
      update_capture_item: {
        Args: {
          p_expected_updated_at: string;
          p_item_id: string;
          p_patch: Json;
        };
        Returns: Json;
      };
      where_cheaper: {
        Args: {
          p_group_id?: string;
          p_product_id?: string;
          p_window_days?: number;
        };
        Returns: Json[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
