"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataTable = DataTable;
function DataTable({ headers, children }) {
    return (<div className="hub-card overflow-hidden">
      <div className="max-h-[70vh] overflow-auto">
        <table className="hub-table">
          <thead>
            <tr>
              {headers.map((header) => (<th key={header}>{header}</th>))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>);
}
