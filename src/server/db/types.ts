
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "ai_analysis_runs": {
                  Row: {
                    "agent": string,"attempts": number,"completion_tokens": number | null,"created_at": string,"created_by": string | null,"error": string | null,"estimated_cost_micro_usd": number | null,"id": string,"input_hash": string,"is_demo": boolean,"latency_ms": number | null,"model_name": string,"output": Json | null,"prompt_tokens": number | null,"prompt_version": string,"provider": Database["public"]['Enums']["ai_provider"],"status": string,"target_id": string | null,"target_type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "agent": string,"attempts"?: number,"completion_tokens"?: number | null,"created_at"?: string,"created_by"?: string | null,"error"?: string | null,"estimated_cost_micro_usd"?: number | null,"id"?: string,"input_hash": string,"is_demo"?: boolean,"latency_ms"?: number | null,"model_name": string,"output"?: Json | null,"prompt_tokens"?: number | null,"prompt_version": string,"provider": Database["public"]['Enums']["ai_provider"],"status": string,"target_id"?: string | null,"target_type": string
                  }
                  Update: {
                    "agent"?: string,"attempts"?: number,"completion_tokens"?: number | null,"created_at"?: string,"created_by"?: string | null,"error"?: string | null,"estimated_cost_micro_usd"?: number | null,"id"?: string,"input_hash"?: string,"is_demo"?: boolean,"latency_ms"?: number | null,"model_name"?: string,"output"?: Json | null,"prompt_tokens"?: number | null,"prompt_version"?: string,"provider"?: Database["public"]['Enums']["ai_provider"],"status"?: string,"target_id"?: string | null,"target_type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_analysis_runs_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"audit_logs": {
                  Row: {
                    "action": string,"actor_id": string | null,"created_at": string,"entity_id": string | null,"entity_type": string | null,"id": string,"metadata": Json | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"created_at"?: string,"entity_id"?: string | null,"entity_type"?: string | null,"id"?: string,"metadata"?: Json | null
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"created_at"?: string,"entity_id"?: string | null,"entity_type"?: string | null,"id"?: string,"metadata"?: Json | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_logs_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"cluster_blueprints": {
                  Row: {
                    "ai_run_id": string | null,"cluster_id": string,"content": NonNullable<Json>,"created_at": string,"created_by": string | null,"id": string,"is_demo": boolean,"markdown": string,"provider": Database["public"]['Enums']["ai_provider"],"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "ai_run_id"?: string | null,"cluster_id": string,"content": NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"id"?: string,"is_demo"?: boolean,"markdown": string,"provider": Database["public"]['Enums']["ai_provider"],"version": number
                  }
                  Update: {
                    "ai_run_id"?: string | null,"cluster_id"?: string,"content"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"id"?: string,"is_demo"?: boolean,"markdown"?: string,"provider"?: Database["public"]['Enums']["ai_provider"],"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "cluster_blueprints_ai_run_id_fkey"
      columns: ["ai_run_id"]
isOneToOne: false
      referencedRelation: "ai_analysis_runs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "cluster_blueprints_cluster_id_fkey"
      columns: ["cluster_id"]
isOneToOne: false
      referencedRelation: "demand_clusters"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "cluster_blueprints_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"cluster_events": {
                  Row: {
                    "actor_id": string | null,"cluster_id": string,"created_at": string,"event_type": string,"id": string,"is_demo": boolean,"payload": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"cluster_id": string,"created_at"?: string,"event_type": string,"id"?: string,"is_demo"?: boolean,"payload"?: NonNullable<Json>
                  }
                  Update: {
                    "actor_id"?: string | null,"cluster_id"?: string,"created_at"?: string,"event_type"?: string,"id"?: string,"is_demo"?: boolean,"payload"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "cluster_events_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "cluster_events_cluster_id_fkey"
      columns: ["cluster_id"]
isOneToOne: false
      referencedRelation: "demand_clusters"
      referencedColumns: ["id"]
    }
                  ]
                },"cluster_memberships": {
                  Row: {
                    "cluster_id": string,"demand_request_id": string | null,"id": string,"is_demo": boolean,"joined_at": string,"request_linked": boolean,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cluster_id": string,"demand_request_id"?: string | null,"id"?: string,"is_demo"?: boolean,"joined_at"?: string,"request_linked"?: boolean,"user_id": string
                  }
                  Update: {
                    "cluster_id"?: string,"demand_request_id"?: string | null,"id"?: string,"is_demo"?: boolean,"joined_at"?: string,"request_linked"?: boolean,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "cluster_memberships_cluster_id_fkey"
      columns: ["cluster_id"]
isOneToOne: false
      referencedRelation: "demand_clusters"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "cluster_memberships_demand_request_id_fkey"
      columns: ["demand_request_id"]
isOneToOne: false
      referencedRelation: "demand_requests"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "cluster_memberships_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"cluster_request_links": {
                  Row: {
                    "cluster_id": string,"created_at": string,"demand_request_id": string,"explanation": string,"id": string,"is_demo": boolean,"linked_by": string,"match_components": NonNullable<Json>,"relevance_score": number
                  }
                  ComputedFields: never
                  Insert: {
                    "cluster_id": string,"created_at"?: string,"demand_request_id": string,"explanation": string,"id"?: string,"is_demo"?: boolean,"linked_by": string,"match_components"?: NonNullable<Json>,"relevance_score": number
                  }
                  Update: {
                    "cluster_id"?: string,"created_at"?: string,"demand_request_id"?: string,"explanation"?: string,"id"?: string,"is_demo"?: boolean,"linked_by"?: string,"match_components"?: NonNullable<Json>,"relevance_score"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "cluster_request_links_cluster_id_fkey"
      columns: ["cluster_id"]
isOneToOne: false
      referencedRelation: "demand_clusters"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "cluster_request_links_demand_request_id_fkey"
      columns: ["demand_request_id"]
isOneToOne: true
      referencedRelation: "demand_requests"
      referencedColumns: ["id"]
    }
                  ]
                },"cluster_snapshots": {
                  Row: {
                    "ai_run_id": string | null,"change_summary": string,"cluster_id": string,"constraints": NonNullable<Json>,"created_at": string,"description": string,"id": string,"is_demo": boolean,"problem_statement": string,"requirements": NonNullable<Json>,"source": string,"title": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "ai_run_id"?: string | null,"change_summary": string,"cluster_id": string,"constraints": NonNullable<Json>,"created_at"?: string,"description": string,"id"?: string,"is_demo"?: boolean,"problem_statement": string,"requirements": NonNullable<Json>,"source": string,"title": string,"version": number
                  }
                  Update: {
                    "ai_run_id"?: string | null,"change_summary"?: string,"cluster_id"?: string,"constraints"?: NonNullable<Json>,"created_at"?: string,"description"?: string,"id"?: string,"is_demo"?: boolean,"problem_statement"?: string,"requirements"?: NonNullable<Json>,"source"?: string,"title"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "cluster_snapshots_ai_run_id_fkey"
      columns: ["ai_run_id"]
isOneToOne: false
      referencedRelation: "ai_analysis_runs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "cluster_snapshots_cluster_id_fkey"
      columns: ["cluster_id"]
isOneToOne: false
      referencedRelation: "demand_clusters"
      referencedColumns: ["id"]
    }
                  ]
                },"demand_clusters": {
                  Row: {
                    "category": Database["public"]['Enums']["category"],"constraints": NonNullable<Json>,"created_at": string,"created_by_request_id": string | null,"current_version": number,"description": string,"difficulty": number | null,"embedding": string | null,"embedding_local": string | null,"embedding_local_version": string | null,"embedding_model": string | null,"id": string,"is_demo": boolean,"merged_into_id": string | null,"metrics_cache": NonNullable<Json>,"metrics_refreshed_at": string | null,"problem_statement": string,"requirements": NonNullable<Json>,"slug": string,"status": Database["public"]['Enums']["cluster_status"],"target_audience": string,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category": Database["public"]['Enums']["category"],"constraints"?: NonNullable<Json>,"created_at"?: string,"created_by_request_id"?: string | null,"current_version"?: number,"description": string,"difficulty"?: number | null,"embedding"?: string | null,"embedding_local"?: string | null,"embedding_local_version"?: string | null,"embedding_model"?: string | null,"id"?: string,"is_demo"?: boolean,"merged_into_id"?: string | null,"metrics_cache"?: NonNullable<Json>,"metrics_refreshed_at"?: string | null,"problem_statement": string,"requirements"?: NonNullable<Json>,"slug": string,"status"?: Database["public"]['Enums']["cluster_status"],"target_audience"?: string,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "category"?: Database["public"]['Enums']["category"],"constraints"?: NonNullable<Json>,"created_at"?: string,"created_by_request_id"?: string | null,"current_version"?: number,"description"?: string,"difficulty"?: number | null,"embedding"?: string | null,"embedding_local"?: string | null,"embedding_local_version"?: string | null,"embedding_model"?: string | null,"id"?: string,"is_demo"?: boolean,"merged_into_id"?: string | null,"metrics_cache"?: NonNullable<Json>,"metrics_refreshed_at"?: string | null,"problem_statement"?: string,"requirements"?: NonNullable<Json>,"slug"?: string,"status"?: Database["public"]['Enums']["cluster_status"],"target_audience"?: string,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "demand_clusters_created_by_request_id_fkey"
      columns: ["created_by_request_id"]
isOneToOne: false
      referencedRelation: "demand_requests"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "demand_clusters_merged_into_id_fkey"
      columns: ["merged_into_id"]
isOneToOne: false
      referencedRelation: "demand_clusters"
      referencedColumns: ["id"]
    }
                  ]
                },"demand_requests": {
                  Row: {
                    "created_at": string,"embedding": string | null,"embedding_local": string,"embedding_local_version": string,"embedding_model": string | null,"id": string,"intent_corrections": Json | null,"intent_provider": Database["public"]['Enums']["ai_provider"],"intent_run_id": string | null,"is_demo": boolean,"normalized_text_hash": string,"raw_text": string,"reference_url": string | null,"stated_price_cents": number | null,"status": Database["public"]['Enums']["request_status"],"structured_intent": NonNullable<Json>,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"embedding"?: string | null,"embedding_local": string,"embedding_local_version": string,"embedding_model"?: string | null,"id"?: string,"intent_corrections"?: Json | null,"intent_provider": Database["public"]['Enums']["ai_provider"],"intent_run_id"?: string | null,"is_demo"?: boolean,"normalized_text_hash": string,"raw_text": string,"reference_url"?: string | null,"stated_price_cents"?: number | null,"status"?: Database["public"]['Enums']["request_status"],"structured_intent": NonNullable<Json>,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"embedding"?: string | null,"embedding_local"?: string,"embedding_local_version"?: string,"embedding_model"?: string | null,"id"?: string,"intent_corrections"?: Json | null,"intent_provider"?: Database["public"]['Enums']["ai_provider"],"intent_run_id"?: string | null,"is_demo"?: boolean,"normalized_text_hash"?: string,"raw_text"?: string,"reference_url"?: string | null,"stated_price_cents"?: number | null,"status"?: Database["public"]['Enums']["request_status"],"structured_intent"?: NonNullable<Json>,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "demand_requests_intent_run_id_fkey"
      columns: ["intent_run_id"]
isOneToOne: false
      referencedRelation: "ai_analysis_runs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "demand_requests_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"evidence_sources": {
                  Row: {
                    "ai_run_id": string | null,"cluster_id": string,"created_at": string,"demand_request_id": string | null,"excerpt": string,"id": string,"is_demo": boolean,"observed_at": string,"source_type": string,"source_url": string | null,"verification_status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "ai_run_id"?: string | null,"cluster_id": string,"created_at"?: string,"demand_request_id"?: string | null,"excerpt": string,"id"?: string,"is_demo"?: boolean,"observed_at": string,"source_type": string,"source_url"?: string | null,"verification_status"?: string
                  }
                  Update: {
                    "ai_run_id"?: string | null,"cluster_id"?: string,"created_at"?: string,"demand_request_id"?: string | null,"excerpt"?: string,"id"?: string,"is_demo"?: boolean,"observed_at"?: string,"source_type"?: string,"source_url"?: string | null,"verification_status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "evidence_sources_ai_run_id_fkey"
      columns: ["ai_run_id"]
isOneToOne: false
      referencedRelation: "ai_analysis_runs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "evidence_sources_cluster_id_fkey"
      columns: ["cluster_id"]
isOneToOne: false
      referencedRelation: "demand_clusters"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "evidence_sources_demand_request_id_fkey"
      columns: ["demand_request_id"]
isOneToOne: false
      referencedRelation: "demand_requests"
      referencedColumns: ["id"]
    }
                  ]
                },"feature_requests": {
                  Row: {
                    "cluster_id": string,"created_at": string,"created_by": string | null,"description": string,"id": string,"is_demo": boolean,"kind": string,"merged_into_id": string | null,"normalized_title": string,"origin": string,"status": string,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cluster_id": string,"created_at"?: string,"created_by"?: string | null,"description"?: string,"id"?: string,"is_demo"?: boolean,"kind": string,"merged_into_id"?: string | null,"normalized_title": string,"origin": string,"status"?: string,"title": string
                  }
                  Update: {
                    "cluster_id"?: string,"created_at"?: string,"created_by"?: string | null,"description"?: string,"id"?: string,"is_demo"?: boolean,"kind"?: string,"merged_into_id"?: string | null,"normalized_title"?: string,"origin"?: string,"status"?: string,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "feature_requests_cluster_id_fkey"
      columns: ["cluster_id"]
isOneToOne: false
      referencedRelation: "demand_clusters"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "feature_requests_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "feature_requests_merged_into_id_fkey"
      columns: ["merged_into_id"]
isOneToOne: false
      referencedRelation: "feature_requests"
      referencedColumns: ["id"]
    }
                  ]
                },"feature_votes": {
                  Row: {
                    "created_at": string,"feature_id": string,"id": string,"is_demo": boolean,"source": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"feature_id": string,"id"?: string,"is_demo"?: boolean,"source": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"feature_id"?: string,"id"?: string,"is_demo"?: boolean,"source"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "feature_votes_feature_id_fkey"
      columns: ["feature_id"]
isOneToOne: false
      referencedRelation: "feature_requests"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "feature_votes_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"merchant_accounts": {
                  Row: {
                    "created_at": string,"display_name": string,"environment": string,"id": string,"is_active": boolean,"kind": string,"onboarding_status": string,"paypal_merchant_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name": string,"environment": string,"id"?: string,"is_active"?: boolean,"kind": string,"onboarding_status": string,"paypal_merchant_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string,"environment"?: string,"id"?: string,"is_active"?: boolean,"kind"?: string,"onboarding_status"?: string,"paypal_merchant_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"moderation_flags": {
                  Row: {
                    "ai_run_id": string | null,"created_at": string,"details": NonNullable<Json>,"entity_id": string,"entity_type": string,"flag_type": string,"id": string,"is_demo": boolean,"resolution_note": string | null,"resolved_at": string | null,"resolved_by": string | null,"severity": string,"source": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "ai_run_id"?: string | null,"created_at"?: string,"details": NonNullable<Json>,"entity_id": string,"entity_type": string,"flag_type": string,"id"?: string,"is_demo"?: boolean,"resolution_note"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"severity": string,"source": string,"status"?: string
                  }
                  Update: {
                    "ai_run_id"?: string | null,"created_at"?: string,"details"?: NonNullable<Json>,"entity_id"?: string,"entity_type"?: string,"flag_type"?: string,"id"?: string,"is_demo"?: boolean,"resolution_note"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"severity"?: string,"source"?: string,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "moderation_flags_ai_run_id_fkey"
      columns: ["ai_run_id"]
isOneToOne: false
      referencedRelation: "ai_analysis_runs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "moderation_flags_resolved_by_fkey"
      columns: ["resolved_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"notifications": {
                  Row: {
                    "created_at": string,"id": string,"payload": NonNullable<Json>,"read_at": string | null,"type": Database["public"]['Enums']["notification_type"],"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"payload": NonNullable<Json>,"read_at"?: string | null,"type": Database["public"]['Enums']["notification_type"],"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"payload"?: NonNullable<Json>,"read_at"?: string | null,"type"?: Database["public"]['Enums']["notification_type"],"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notifications_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"offer_deliverables": {
                  Row: {
                    "access_url": string | null,"deliverable_key": string | null,"delivery_type": string,"offer_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "access_url"?: string | null,"deliverable_key"?: string | null,"delivery_type": string,"offer_id": string
                  }
                  Update: {
                    "access_url"?: string | null,"deliverable_key"?: string | null,"delivery_type"?: string,"offer_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "offer_deliverables_offer_id_fkey"
      columns: ["offer_id"]
isOneToOne: true
      referencedRelation: "product_offers"
      referencedColumns: ["id"]
    }
                  ]
                },"payment_status_history": {
                  Row: {
                    "created_at": string,"detail": NonNullable<Json>,"from_status": Database["public"]['Enums']["payment_status"] | null,"id": string,"payment_id": string,"source": string,"to_status": Database["public"]['Enums']["payment_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"detail"?: NonNullable<Json>,"from_status"?: Database["public"]['Enums']["payment_status"] | null,"id"?: string,"payment_id": string,"source": string,"to_status": Database["public"]['Enums']["payment_status"]
                  }
                  Update: {
                    "created_at"?: string,"detail"?: NonNullable<Json>,"from_status"?: Database["public"]['Enums']["payment_status"] | null,"id"?: string,"payment_id"?: string,"source"?: string,"to_status"?: Database["public"]['Enums']["payment_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_status_history_payment_id_fkey"
      columns: ["payment_id"]
isOneToOne: false
      referencedRelation: "payments"
      referencedColumns: ["id"]
    }
                  ]
                },"payments": {
                  Row: {
                    "amount_cents": number,"buyer_id": string,"capture_attempt": number,"cluster_id": string,"completed_at": string | null,"created_at": string,"currency": string,"failure_code": string | null,"failure_message": string | null,"id": string,"idempotency_key": string,"merchant_id": string,"metadata": NonNullable<Json>,"offer_id": string,"paypal_capture_id": string | null,"paypal_env": string,"paypal_order_id": string | null,"paypal_payer_id": string | null,"proposal_id": string,"refunded_cents": number,"status": Database["public"]['Enums']["payment_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents": number,"buyer_id": string,"capture_attempt"?: number,"cluster_id": string,"completed_at"?: string | null,"created_at"?: string,"currency": string,"failure_code"?: string | null,"failure_message"?: string | null,"id"?: string,"idempotency_key"?: string,"merchant_id": string,"metadata"?: NonNullable<Json>,"offer_id": string,"paypal_capture_id"?: string | null,"paypal_env": string,"paypal_order_id"?: string | null,"paypal_payer_id"?: string | null,"proposal_id": string,"refunded_cents"?: number,"status"?: Database["public"]['Enums']["payment_status"],"updated_at"?: string
                  }
                  Update: {
                    "amount_cents"?: number,"buyer_id"?: string,"capture_attempt"?: number,"cluster_id"?: string,"completed_at"?: string | null,"created_at"?: string,"currency"?: string,"failure_code"?: string | null,"failure_message"?: string | null,"id"?: string,"idempotency_key"?: string,"merchant_id"?: string,"metadata"?: NonNullable<Json>,"offer_id"?: string,"paypal_capture_id"?: string | null,"paypal_env"?: string,"paypal_order_id"?: string | null,"paypal_payer_id"?: string | null,"proposal_id"?: string,"refunded_cents"?: number,"status"?: Database["public"]['Enums']["payment_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_buyer_id_fkey"
      columns: ["buyer_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_cluster_id_fkey"
      columns: ["cluster_id"]
isOneToOne: false
      referencedRelation: "demand_clusters"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_merchant_id_fkey"
      columns: ["merchant_id"]
isOneToOne: false
      referencedRelation: "merchant_accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_offer_id_fkey"
      columns: ["offer_id"]
isOneToOne: false
      referencedRelation: "product_offers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_proposal_id_fkey"
      columns: ["proposal_id"]
isOneToOne: false
      referencedRelation: "product_proposals"
      referencedColumns: ["id"]
    }
                  ]
                },"product_build_updates": {
                  Row: {
                    "author_id": string,"content": string,"created_at": string,"id": string,"is_demo": boolean,"progress_status": string,"proposal_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id": string,"content": string,"created_at"?: string,"id"?: string,"is_demo"?: boolean,"progress_status": string,"proposal_id": string
                  }
                  Update: {
                    "author_id"?: string,"content"?: string,"created_at"?: string,"id"?: string,"is_demo"?: boolean,"progress_status"?: string,"proposal_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_build_updates_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_build_updates_proposal_id_fkey"
      columns: ["proposal_id"]
isOneToOne: false
      referencedRelation: "product_proposals"
      referencedColumns: ["id"]
    }
                  ]
                },"product_offers": {
                  Row: {
                    "access_expected_at": string | null,"availability_status": Database["public"]['Enums']["offer_availability"],"builder_id": string,"cluster_id": string,"created_at": string,"currency": string,"delivered_features": (string)[],"delivery_terms": string,"demo_url": string | null,"description": string,"id": string,"is_demo": boolean,"merchant_id": string,"offer_type": Database["public"]['Enums']["offer_type"],"price_cents": number,"product_exists": boolean,"product_url": string | null,"proposal_id": string,"published_at": string | null,"refund_terms": string,"refund_window_days": number,"screenshots": (string)[],"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "access_expected_at"?: string | null,"availability_status"?: Database["public"]['Enums']["offer_availability"],"builder_id": string,"cluster_id": string,"created_at"?: string,"currency": string,"delivered_features"?: (string)[],"delivery_terms": string,"demo_url"?: string | null,"description": string,"id"?: string,"is_demo"?: boolean,"merchant_id": string,"offer_type": Database["public"]['Enums']["offer_type"],"price_cents": number,"product_exists": boolean,"product_url"?: string | null,"proposal_id": string,"published_at"?: string | null,"refund_terms": string,"refund_window_days": number,"screenshots"?: (string)[],"title": string,"updated_at"?: string
                  }
                  Update: {
                    "access_expected_at"?: string | null,"availability_status"?: Database["public"]['Enums']["offer_availability"],"builder_id"?: string,"cluster_id"?: string,"created_at"?: string,"currency"?: string,"delivered_features"?: (string)[],"delivery_terms"?: string,"demo_url"?: string | null,"description"?: string,"id"?: string,"is_demo"?: boolean,"merchant_id"?: string,"offer_type"?: Database["public"]['Enums']["offer_type"],"price_cents"?: number,"product_exists"?: boolean,"product_url"?: string | null,"proposal_id"?: string,"published_at"?: string | null,"refund_terms"?: string,"refund_window_days"?: number,"screenshots"?: (string)[],"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_offers_builder_id_fkey"
      columns: ["builder_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_offers_cluster_id_fkey"
      columns: ["cluster_id"]
isOneToOne: false
      referencedRelation: "demand_clusters"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_offers_merchant_id_fkey"
      columns: ["merchant_id"]
isOneToOne: false
      referencedRelation: "merchant_accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_offers_proposal_id_fkey"
      columns: ["proposal_id"]
isOneToOne: false
      referencedRelation: "product_proposals"
      referencedColumns: ["id"]
    }
                  ]
                },"product_proposals": {
                  Row: {
                    "approach": string,"builder_id": string,"cluster_id": string,"created_at": string,"currency": string,"demo_url": string | null,"description": string,"id": string,"is_demo": boolean,"project_url": string | null,"proposed_price_cents": number | null,"scope": string,"status": Database["public"]['Enums']["proposal_status"],"tech_stack": (string)[],"timeline": string,"title": string,"updated_at": string,"verification_status": Database["public"]['Enums']["verification_status"],"verified_at": string | null,"verified_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "approach"?: string,"builder_id": string,"cluster_id": string,"created_at"?: string,"currency"?: string,"demo_url"?: string | null,"description": string,"id"?: string,"is_demo"?: boolean,"project_url"?: string | null,"proposed_price_cents"?: number | null,"scope"?: string,"status"?: Database["public"]['Enums']["proposal_status"],"tech_stack"?: (string)[],"timeline"?: string,"title": string,"updated_at"?: string,"verification_status"?: Database["public"]['Enums']["verification_status"],"verified_at"?: string | null,"verified_by"?: string | null
                  }
                  Update: {
                    "approach"?: string,"builder_id"?: string,"cluster_id"?: string,"created_at"?: string,"currency"?: string,"demo_url"?: string | null,"description"?: string,"id"?: string,"is_demo"?: boolean,"project_url"?: string | null,"proposed_price_cents"?: number | null,"scope"?: string,"status"?: Database["public"]['Enums']["proposal_status"],"tech_stack"?: (string)[],"timeline"?: string,"title"?: string,"updated_at"?: string,"verification_status"?: Database["public"]['Enums']["verification_status"],"verified_at"?: string | null,"verified_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_proposals_builder_id_fkey"
      columns: ["builder_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_proposals_cluster_id_fkey"
      columns: ["cluster_id"]
isOneToOne: false
      referencedRelation: "demand_clusters"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_proposals_verified_by_fkey"
      columns: ["verified_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"product_reviews": {
                  Row: {
                    "body": string | null,"buyer_id": string,"created_at": string,"id": string,"is_demo": boolean,"offer_id": string,"payment_id": string,"rating": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body"?: string | null,"buyer_id": string,"created_at"?: string,"id"?: string,"is_demo"?: boolean,"offer_id": string,"payment_id": string,"rating": number,"updated_at"?: string
                  }
                  Update: {
                    "body"?: string | null,"buyer_id"?: string,"created_at"?: string,"id"?: string,"is_demo"?: boolean,"offer_id"?: string,"payment_id"?: string,"rating"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_reviews_buyer_id_fkey"
      columns: ["buyer_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_reviews_offer_id_fkey"
      columns: ["offer_id"]
isOneToOne: false
      referencedRelation: "product_offers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_reviews_payment_id_fkey"
      columns: ["payment_id"]
isOneToOne: true
      referencedRelation: "payments"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "avatar_url": string | null,"bio": string | null,"created_at": string,"display_name": string,"id": string,"is_demo": boolean,"is_platform_builder": boolean,"role": Database["public"]['Enums']["user_role"],"trust_weight": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar_url"?: string | null,"bio"?: string | null,"created_at"?: string,"display_name": string,"id": string,"is_demo"?: boolean,"is_platform_builder"?: boolean,"role"?: Database["public"]['Enums']["user_role"],"trust_weight"?: number,"updated_at"?: string
                  }
                  Update: {
                    "avatar_url"?: string | null,"bio"?: string | null,"created_at"?: string,"display_name"?: string,"id"?: string,"is_demo"?: boolean,"is_platform_builder"?: boolean,"role"?: Database["public"]['Enums']["user_role"],"trust_weight"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"purchase_intents": {
                  Row: {
                    "cluster_id": string,"created_at": string,"currency": string,"id": string,"is_demo": boolean,"level": Database["public"]['Enums']["intent_level"],"maximum_price_cents": number | null,"status": string,"target_price_cents": number | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cluster_id": string,"created_at"?: string,"currency"?: string,"id"?: string,"is_demo"?: boolean,"level": Database["public"]['Enums']["intent_level"],"maximum_price_cents"?: number | null,"status"?: string,"target_price_cents"?: number | null,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "cluster_id"?: string,"created_at"?: string,"currency"?: string,"id"?: string,"is_demo"?: boolean,"level"?: Database["public"]['Enums']["intent_level"],"maximum_price_cents"?: number | null,"status"?: string,"target_price_cents"?: number | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "purchase_intents_cluster_id_fkey"
      columns: ["cluster_id"]
isOneToOne: false
      referencedRelation: "demand_clusters"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "purchase_intents_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"rate_limit_buckets": {
                  Row: {
                    "count": number,"key": string,"window_start": string
                  }
                  ComputedFields: never
                  Insert: {
                    "count": number,"key": string,"window_start": string
                  }
                  Update: {
                    "count"?: number,"key"?: string,"window_start"?: string
                  }
                  Relationships: [
                    
                  ]
                },"refunds": {
                  Row: {
                    "admin_note": string | null,"amount_cents": number,"created_at": string,"currency": string,"failure_message": string | null,"id": string,"idempotency_key": string,"payment_id": string,"paypal_refund_id": string | null,"reason": string,"requested_by": string,"reviewed_at": string | null,"reviewed_by": string | null,"status": Database["public"]['Enums']["refund_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "admin_note"?: string | null,"amount_cents": number,"created_at"?: string,"currency": string,"failure_message"?: string | null,"id"?: string,"idempotency_key"?: string,"payment_id": string,"paypal_refund_id"?: string | null,"reason": string,"requested_by": string,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"status"?: Database["public"]['Enums']["refund_status"],"updated_at"?: string
                  }
                  Update: {
                    "admin_note"?: string | null,"amount_cents"?: number,"created_at"?: string,"currency"?: string,"failure_message"?: string | null,"id"?: string,"idempotency_key"?: string,"payment_id"?: string,"paypal_refund_id"?: string | null,"reason"?: string,"requested_by"?: string,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"status"?: Database["public"]['Enums']["refund_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "refunds_payment_id_fkey"
      columns: ["payment_id"]
isOneToOne: false
      referencedRelation: "payments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "refunds_requested_by_fkey"
      columns: ["requested_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "refunds_reviewed_by_fkey"
      columns: ["reviewed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"webhook_events": {
                  Row: {
                    "attempts": number,"event_type": string,"id": string,"payload": NonNullable<Json>,"processed_at": string | null,"processing_error": string | null,"processing_status": string,"provider": string,"provider_event_id": string,"received_at": string,"resource_id": string | null,"resource_type": string | null,"verification_status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"event_type": string,"id"?: string,"payload": NonNullable<Json>,"processed_at"?: string | null,"processing_error"?: string | null,"processing_status": string,"provider"?: string,"provider_event_id": string,"received_at"?: string,"resource_id"?: string | null,"resource_type"?: string | null,"verification_status": string
                  }
                  Update: {
                    "attempts"?: number,"event_type"?: string,"id"?: string,"payload"?: NonNullable<Json>,"processed_at"?: string | null,"processing_error"?: string | null,"processing_status"?: string,"provider"?: string,"provider_event_id"?: string,"received_at"?: string,"resource_id"?: string | null,"resource_type"?: string | null,"verification_status"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "advance_payment":
{ Args: { "p_detail": Json,"p_from": Database["public"]['Enums']["payment_status"],"p_id": string,"p_patch": Json,"p_path": (Database["public"]['Enums']["payment_status"])[],"p_source": string }; Returns: Json
                           },
"apply_cluster_change":
{ Args: { "p_ai_run_id": string,"p_change_summary": string,"p_cluster_id": string,"p_patch": Json,"p_source": string }; Returns: number
                           },
"apply_refund_outcome":
{ Args: { "p_failure_message": string,"p_outcome": string,"p_paypal_refund_id": string,"p_refund_id": string,"p_source": string }; Returns: Json
                           },
"cluster_similarity_edges":
{ Args: { "p_max_per_node": number,"p_min_sim": number,"p_model": string,"p_space": string }; Returns: {
              "similarity": number,"source_id": string,"target_id": string
            }[]
                           },
"is_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"join_cluster":
{ Args: { "p_cluster_id": string,"p_components": Json,"p_explanation": string,"p_inferred": Json,"p_link": boolean,"p_relevance": number,"p_request_id": string,"p_selected_feature_ids": (string)[],"p_user_id": string }; Returns: Json
                           },
"match_clusters":
{ Args: { "match_count": number,"model": string,"query": string,"space": string }; Returns: {
              "cluster_id": string,"similarity": number
            }[]
                           },
"match_requests":
{ Args: { "match_count": number,"model": string,"query": string,"space": string }; Returns: {
              "cluster_id": string,"demand_request_id": string,"similarity": number
            }[]
                           },
"merge_clusters":
{ Args: { "p_actor": string,"p_reason": string,"p_source": string,"p_target": string }; Returns: Json
                           },
"rate_limit_hit":
{ Args: { "p_key": string,"p_limit": number,"p_window_seconds": number }; Returns: boolean
                           },
"recompute_payment_refunds":
{ Args: { "p_payment_id": string,"p_source": string }; Returns: Json
                           },
"refresh_cluster_centroid":
{ Args: { "p_cluster_id": string }; Returns: undefined
                           },
"refund_side_allowed_from":
{ Args: { "p_target": Database["public"]['Enums']["payment_status"] }; Returns: (Database["public"]['Enums']["payment_status"])[]
                           },
"requirements_snapshot":
{ Args: { "p_cluster_id": string }; Returns: Json
                           },
"reset_demo_data":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"split_cluster":
{ Args: { "p_actor": string,"p_category": Database["public"]['Enums']["category"],"p_cluster": string,"p_new_title": string,"p_request_ids": (string)[] }; Returns: Json
                           }
          }
          Enums: {
            "ai_provider": "llm"|"fallback","category": "software"|"developer_tools"|"productivity"|"education"|"design"|"ai_products"|"business_tools"|"browser_extensions"|"mobile_apps","cluster_status": "emerging"|"active"|"building"|"launched"|"merged"|"archived"|"hidden","intent_level": "interested"|"price_qualified","notification_type": "cluster_match_found"|"cluster_new_members"|"proposal_submitted"|"build_started"|"build_update"|"product_launched"|"purchase_completed"|"refund_status_changed"|"product_reviewed","offer_availability": "draft"|"available"|"paused"|"listing_only"|"retired","offer_type": "completed_product"|"early_access","payment_status": "CREATED"|"APPROVAL_PENDING"|"APPROVED"|"CAPTURE_PENDING"|"COMPLETED"|"FAILED"|"REFUND_PENDING"|"PARTIALLY_REFUNDED"|"REFUNDED","proposal_status": "submitted"|"building"|"launched"|"withdrawn","refund_status": "REQUESTED"|"REJECTED"|"PENDING"|"COMPLETED"|"FAILED","request_status": "analyzed"|"matched"|"new_cluster"|"unclustered"|"hidden"|"spam","user_role": "buyer"|"builder"|"admin","verification_status": "unverified"|"verified"|"rejected"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "ai_provider": ["llm", "fallback"],"category": ["software", "developer_tools", "productivity", "education", "design", "ai_products", "business_tools", "browser_extensions", "mobile_apps"],"cluster_status": ["emerging", "active", "building", "launched", "merged", "archived", "hidden"],"intent_level": ["interested", "price_qualified"],"notification_type": ["cluster_match_found", "cluster_new_members", "proposal_submitted", "build_started", "build_update", "product_launched", "purchase_completed", "refund_status_changed", "product_reviewed"],"offer_availability": ["draft", "available", "paused", "listing_only", "retired"],"offer_type": ["completed_product", "early_access"],"payment_status": ["CREATED", "APPROVAL_PENDING", "APPROVED", "CAPTURE_PENDING", "COMPLETED", "FAILED", "REFUND_PENDING", "PARTIALLY_REFUNDED", "REFUNDED"],"proposal_status": ["submitted", "building", "launched", "withdrawn"],"refund_status": ["REQUESTED", "REJECTED", "PENDING", "COMPLETED", "FAILED"],"request_status": ["analyzed", "matched", "new_cluster", "unclustered", "hidden", "spam"],"user_role": ["buyer", "builder", "admin"],"verification_status": ["unverified", "verified", "rejected"]
          }
        }
} as const
