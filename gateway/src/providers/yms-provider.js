"use strict";

const { GatewayError } = require("../errors");

const MOCK_YMS_ROWS = Object.freeze([
  Object.freeze({
    facility_id: "SSP15",
    operation_date: "2026-09-02",
    cycle_name: "AM1",
    wave_number: 1,
    process_id: "PROCESSO-MOCK-DISPATCHED",
    executed_route_id: "434014897",
    planned_route_id: "503226595004",
    route_name: "VJ3_AM1",
    planned_route_name: "A3_AM1",
    route_changed_from_plan: true,
    route_resolution_status: "resolved",
    carrier_name: "UNICA TRANSPORTES",
    planned_carrier_name: "TRANSPORTADORA PLANEJADA",
    plate: "SDD-UEO6I01",
    loading_zone_name: "2",
    parking_area_name: "VAGAS DE EXPEDIÇÃO",
    yms_check_in_at: "2026-09-02 08:49:13",
    dock_in_at: "2026-09-02 09:02:48",
    customs_queue_at: "",
    customs_started_at: "",
    customs_last_activity_at: "",
    loading_started_at: "2026-09-02 09:03:37",
    dock_out_at: "2026-09-02 09:36:17",
    gate_out_at: "2026-09-02 09:36:26",
    latest_event_name: "gate-out",
    latest_status: "PROCESS_FINISHED",
    latest_purpose_status: "LOADING_PACKAGES_STARTED",
    latest_event_at: "2026-09-02 09:36:26"
  }),
  Object.freeze({
    facility_id: "SSP15",
    operation_date: "2026-09-02",
    cycle_name: "AM1",
    wave_number: 2,
    process_id: "PROCESSO-MOCK-ADUANA",
    executed_route_id: "",
    planned_route_id: "503226595008",
    route_name: "N3_AM1",
    planned_route_name: "N3_AM1",
    route_changed_from_plan: false,
    route_resolution_status: "resolved",
    carrier_name: "ON TIME SERVICOS",
    planned_carrier_name: "ON TIME SERVICOS",
    plate: "SDD-UDA4F01",
    loading_zone_name: "12",
    parking_area_name: "VAGAS DE EXPEDIÇÃO",
    yms_check_in_at: "2026-09-02 08:54:24",
    dock_in_at: "2026-09-02 08:56:25",
    customs_queue_at: "2026-09-02 09:00:00",
    customs_started_at: "2026-09-02 09:02:00",
    customs_last_activity_at: "2026-09-02 09:05:00",
    loading_started_at: "",
    dock_out_at: "",
    gate_out_at: "",
    latest_event_name: "update_purpose_status",
    latest_status: "UN-LOAD_STARTED",
    latest_purpose_status: "DOING_AUDIT",
    latest_event_at: "2026-09-02 09:05:00"
  }),
  Object.freeze({
    facility_id: "SSP15",
    operation_date: "2026-09-02",
    cycle_name: "AM1",
    wave_number: 3,
    process_id: "PROCESSO-MOCK-LOADING",
    executed_route_id: "",
    planned_route_id: "503226587006",
    route_name: "C2_AM1",
    planned_route_name: "N3_AM1",
    route_changed_from_plan: true,
    route_resolution_status: "resolved",
    carrier_name: "JM Transportes",
    planned_carrier_name: "JM Transportes",
    plate: "FXY4E11",
    loading_zone_name: "11",
    parking_area_name: "VAGAS DE EXPEDIÇÃO",
    yms_check_in_at: "2026-09-02 08:15:24",
    dock_in_at: "2026-09-02 08:20:00",
    customs_queue_at: "",
    customs_started_at: "",
    customs_last_activity_at: "",
    loading_started_at: "2026-09-02 08:30:00",
    dock_out_at: "",
    gate_out_at: "",
    latest_event_name: "update_purpose_status",
    latest_status: "UN-LOAD_STARTED",
    latest_purpose_status: "LOADING_PACKAGES_STARTED",
    latest_event_at: "2026-09-02 08:30:00"
  }),
  Object.freeze({
    facility_id: "SSP15",
    operation_date: "2026-09-02",
    cycle_name: "AM1",
    wave_number: 1,
    process_id: "PROCESSO-MOCK-DOCK-DIVERGENCE",
    executed_route_id: "",
    planned_route_id: "502731583001",
    route_name: "VT9_AM1",
    planned_route_name: "VT9_AM1",
    route_changed_from_plan: false,
    route_resolution_status: "resolved",
    carrier_name: "TRANSPORTADORA TESTE",
    planned_carrier_name: "TRANSPORTADORA TESTE",
    plate: "MOCK9A01",
    loading_zone_name: "4",
    parking_area_name: "VAGAS DE EXPEDIÇÃO",
    yms_check_in_at: "2026-09-02 08:10:00",
    dock_in_at: "2026-09-02 08:15:00",
    customs_queue_at: "",
    customs_started_at: "",
    customs_last_activity_at: "",
    loading_started_at: "2026-09-02 08:25:00",
    dock_out_at: "",
    gate_out_at: "",
    latest_event_name: "update_purpose_status",
    latest_status: "UN-LOAD_STARTED",
    latest_purpose_status: "LOADING_PACKAGES_STARTED",
    latest_event_at: "2026-09-02 08:25:00"
  }),
  Object.freeze({
    facility_id: "SSP15",
    operation_date: "2026-09-02",
    cycle_name: "AM1",
    wave_number: 3,
    process_id: "PROCESSO-MOCK-DISPATCH-AHEAD",
    executed_route_id: "",
    planned_route_id: "502731588003",
    route_name: "VT12_AM1",
    planned_route_name: "VT12_AM1",
    route_changed_from_plan: false,
    route_resolution_status: "resolved",
    carrier_name: "TRANSPORTADORA TESTE",
    planned_carrier_name: "TRANSPORTADORA TESTE",
    plate: "MOCK12A1",
    loading_zone_name: "1",
    parking_area_name: "VAGAS DE EXPEDIÇÃO",
    yms_check_in_at: "2026-09-02 08:40:00",
    dock_in_at: "2026-09-02 08:45:00",
    customs_queue_at: "",
    customs_started_at: "",
    customs_last_activity_at: "",
    loading_started_at: "",
    dock_out_at: "",
    gate_out_at: "",
    latest_event_name: "check-in-without-prior-assignment",
    latest_status: "UN-LOAD_STARTED",
    latest_purpose_status: "WAITING_FOR_PACKAGES",
    latest_event_at: "2026-09-02 08:45:00"
  }),
  Object.freeze({
    facility_id: "SSP15",
    operation_date: "2026-09-02",
    cycle_name: "AM1",
    wave_number: 4,
    process_id: "PROCESSO-MOCK-EXCEPTION",
    executed_route_id: "",
    planned_route_id: "503226574001",
    route_name: "VV8_AM1",
    planned_route_name: "VV8_AM1",
    route_changed_from_plan: false,
    route_resolution_status: "resolved",
    carrier_name: "UNICA TRANSPORTES",
    planned_carrier_name: "UNICA TRANSPORTES",
    plate: "TDY3E03",
    loading_zone_name: "23",
    parking_area_name: "VAGAS DE EXPEDIÇÃO",
    yms_check_in_at: "2026-09-02 09:04:39",
    dock_in_at: "2026-09-02 09:07:39",
    customs_queue_at: "",
    customs_started_at: "",
    customs_last_activity_at: "",
    loading_started_at: "2026-09-02 09:44:38",
    dock_out_at: "",
    gate_out_at: "",
    latest_event_name: "killed",
    latest_status: "UN-LOAD_UNFINISHED",
    latest_purpose_status: "LOADING_PACKAGES_STARTED",
    latest_event_at: "2026-09-02 09:50:09"
  })
]);

function createYmsProvider(config) {
  if (config.ymsMode === "disabled") {
    return Object.freeze({
      mode: "disabled",
      inspectConfiguration() {
        return { configured: true, mode: "disabled" };
      },
      async query() {
        return [];
      }
    });
  }

  if (config.ymsMode === "mock") {
    return Object.freeze({
      mode: "mock",
      inspectConfiguration() {
        return { configured: true, mode: "mock" };
      },
      async query({ scenario }) {
        if (new Set(["empty-unconfirmed", "empty-confirmed"]).has(scenario)) return [];
        return MOCK_YMS_ROWS.map(row => ({ ...row }));
      }
    });
  }

  return Object.freeze({
    mode: "provider",
    inspectConfiguration() {
      return {
        configured: false,
        mode: "provider",
        reason: "YMS_PROVIDER_NOT_CONFIGURED"
      };
    },
    async query() {
      throw new GatewayError(
        503,
        "YMS_PROVIDER_NOT_CONFIGURED",
        "Provider YMS/BigQuery ainda nao foi configurado pela infraestrutura."
      );
    }
  });
}

function isYmsProviderReady(config, provider) {
  if (config.ymsMode === "disabled" || config.ymsMode === "mock") return true;
  if (!provider || typeof provider.query !== "function") return false;
  if (typeof provider.inspectConfiguration !== "function") return true;
  return provider.inspectConfiguration()?.configured === true;
}

module.exports = {
  MOCK_YMS_ROWS,
  createYmsProvider,
  isYmsProviderReady
};
