"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapNextActionToAgentAction = mapNextActionToAgentAction;
const buildAgentAction_1 = require("./buildAgentAction");
function mapNextActionToAgentAction(input) {
    return (0, buildAgentAction_1.buildAgentActionFromNextAction)(input);
}
