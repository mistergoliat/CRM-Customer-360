"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapFollowUpPlanToAgentAction = mapFollowUpPlanToAgentAction;
const buildAgentAction_1 = require("./buildAgentAction");
function mapFollowUpPlanToAgentAction(input) {
    return (0, buildAgentAction_1.buildAgentActionFromFollowUpPlan)(input);
}
