"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Icon = Icon;
const clsx_1 = __importDefault(require("clsx"));
function Icon({ name, className, title }) {
    return (<span aria-hidden={title ? undefined : true} title={title} className={(0, clsx_1.default)("material-symbols-outlined", className)}>
      {name}
    </span>);
}
