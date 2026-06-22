"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.default = AiSdrSimulatorPage;
const ScenarioSimulatorPanel_1 = require("@/components/cases/ai-sdr/scenario-simulator/ScenarioSimulatorPanel");
const scenario_simulator_1 = require("@/lib/brain/commercial/scenario-simulator");
function getParam(searchParams, key) {
    const value = searchParams[key];
    return Array.isArray(value) ? value[0] : value;
}
function parseMode(value) {
    if (value === "observe" || value === "simulate" || value === "execute_fake")
        return value;
    return "simulate";
}
function buildScenarioFlags() {
    return {
        enabled: process.env.BRAIN_SCENARIO_SIMULATOR_ENABLED === "true",
        allowExecuteFake: process.env.BRAIN_SCENARIO_SIMULATOR_ALLOW_EXECUTE_FAKE === "true"
    };
}
exports.dynamic = "force-dynamic";
async function AiSdrSimulatorPage({ searchParams }) {
    const sp = await searchParams;
    const flags = buildScenarioFlags();
    const selectedScenarioId = getParam(sp, "scenarioId") ?? scenario_simulator_1.SCENARIO_CATALOG[0]?.scenarioId ?? "";
    const requestedMode = parseMode(getParam(sp, "mode"));
    const selectedMode = requestedMode === "execute_fake" && !flags.allowExecuteFake ? "simulate" : requestedMode;
    const selectedScenario = scenario_simulator_1.SCENARIO_CATALOG.find((scenario) => scenario.scenarioId === selectedScenarioId) ?? scenario_simulator_1.SCENARIO_CATALOG[0];
    let result = null;
    let reportJson = null;
    if (flags.enabled && selectedScenario) {
        const scenario = structuredClone(selectedScenario);
        scenario.steps = scenario.steps.map((step) => ({
            ...step,
            mode: step.mode === "execute_fake" && !flags.allowExecuteFake ? "simulate" : selectedMode,
            input: {
                ...step.input,
                mode: step.mode === "execute_fake" && !flags.allowExecuteFake ? "simulate" : selectedMode
            }
        }));
        result = await (0, scenario_simulator_1.executeScenario)(scenario);
        reportJson = (0, scenario_simulator_1.exportScenarioSafeResult)(result);
    }
    return (<ScenarioSimulatorPanel_1.ScenarioSimulatorPanel scenarios={scenario_simulator_1.SCENARIO_CATALOG} selectedScenarioId={selectedScenario?.scenarioId ?? selectedScenarioId} selectedMode={selectedMode} enabled={flags.enabled} allowExecuteFake={flags.allowExecuteFake} result={result} reportJson={reportJson}/>);
}
