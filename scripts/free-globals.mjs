// Free identifiers in the site's own modules (#74): every name a module reads that it
// never declares or imports. Dependency-free: parses with the acorn copy that ships
// inside Node, so it must run as `node --expose-internals scripts/free-globals.mjs`
// (test/free-globals.test.mjs does that). Prints JSON: { file: { name: firstLine } }.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const acorn = require("internal/deps/acorn/acorn/dist/acorn");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The repo's own browser and Node modules (tests, vendored and generated code left out). */
export function sourceFiles() {
  const out = [];
  const add = (dir, re) => {
    const d = path.join(root, dir);
    if (!fs.existsSync(d)) return;
    for (const f of fs.readdirSync(d).sort()) if (re.test(f)) out.push(path.posix.join(dir, f).replace(/^\.\//, ""));
  };
  add(".", /\.(mjs|js)$/);
  add("scripts", /\.mjs$/);
  add("data", /\.mjs$/);
  add("oracle/js", /\.js$/);
  return out;
}

class Scope {
  constructor(parent, isFn) { this.parent = parent; this.isFn = isFn; this.names = new Set(); }
  fn() { let s = this; while (!s.isFn) s = s.parent; return s; }
  has(n) { for (let s = this; s; s = s.parent) if (s.names.has(n)) return true; return false; }
}

export function freeNames(code) {
  let ast;
  const opts = { ecmaVersion: "latest", locations: true, allowHashBang: true };
  try { ast = acorn.parse(code, { ...opts, sourceType: "module" }); }
  catch { ast = acorn.parse(code, { ...opts, sourceType: "script" }); }
  const refs = [];
  const top = new Scope(null, true);

  const declare = (p, scope, refScope) => {
    if (!p) return;
    switch (p.type) {
      case "Identifier": scope.names.add(p.name); break;
      case "ObjectPattern":
        for (const q of p.properties) {
          if (q.type === "RestElement") declare(q.argument, scope, refScope);
          else { if (q.computed) visit(q.key, refScope); declare(q.value, scope, refScope); }
        }
        break;
      case "ArrayPattern": for (const q of p.elements) declare(q, scope, refScope); break;
      case "RestElement": declare(p.argument, scope, refScope); break;
      case "AssignmentPattern": declare(p.left, scope, refScope); visit(p.right, refScope); break;
      default: visit(p, refScope); // member expressions as assignment targets
    }
  };
  const fnScope = (node, scope) => {
    const s = new Scope(scope, true);
    if (node.type === "FunctionExpression" && node.id) s.names.add(node.id.name);
    if (node.type !== "ArrowFunctionExpression") s.names.add("arguments");
    for (const p of node.params) declare(p, s, s);
    if (node.body.type === "BlockStatement") for (const st of node.body.body) visit(st, s);
    else visit(node.body, s);
  };
  const block = (stmts, scope) => { const s = new Scope(scope, false); for (const st of stmts) visit(st, s); return s; };

  function visit(node, scope) {
    if (!node || typeof node.type !== "string") return;
    switch (node.type) {
      case "Identifier": refs.push([node.name, scope, node.loc.start.line]); return;
      case "UnaryExpression":
        if (node.operator === "typeof" && node.argument.type === "Identifier") return; // typeof x: a guarded check
        visit(node.argument, scope); return;
      case "MemberExpression": visit(node.object, scope); if (node.computed) visit(node.property, scope); return;
      case "Property": case "PropertyDefinition": case "MethodDefinition":
        if (node.computed) visit(node.key, scope);
        if (node.value) visit(node.value, scope);
        return;
      case "LabeledStatement": visit(node.body, scope); return;
      case "BreakStatement": case "ContinueStatement": case "MetaProperty": case "Literal": case "Super": case "ThisExpression": case "PrivateIdentifier": case "TemplateElement": return;
      case "ImportDeclaration": for (const s of node.specifiers) top.names.add(s.local.name); return;
      case "ExportNamedDeclaration":
        if (node.declaration) visit(node.declaration, scope);
        else if (!node.source) for (const s of node.specifiers) visit(s.local, scope);
        return;
      case "ExportAllDeclaration": return;
      case "VariableDeclaration": {
        const target = node.kind === "var" ? scope.fn() : scope;
        for (const d of node.declarations) { declare(d.id, target, scope); visit(d.init, scope); }
        return;
      }
      case "FunctionDeclaration": scope.names.add(node.id.name); fnScope(node, scope); return;
      case "FunctionExpression": case "ArrowFunctionExpression": fnScope(node, scope); return;
      case "ClassDeclaration": case "ClassExpression": {
        if (node.type === "ClassDeclaration") scope.names.add(node.id.name);
        const s = new Scope(scope, false);
        if (node.id) s.names.add(node.id.name);
        visit(node.superClass, scope);
        for (const m of node.body.body) {
          if (m.type === "StaticBlock") block(m.body, new Scope(s, true));
          else visit(m, s);
        }
        return;
      }
      case "BlockStatement": block(node.body, scope); return;
      case "StaticBlock": block(node.body, scope); return;
      case "CatchClause": { const s = new Scope(scope, false); declare(node.param, s, s); block(node.body.body, s); return; }
      case "ForStatement": { const s = new Scope(scope, false); visit(node.init, s); visit(node.test, s); visit(node.update, s); visit(node.body, s); return; }
      case "ForInStatement": case "ForOfStatement": {
        const s = new Scope(scope, false);
        if (node.left.type === "VariableDeclaration") visit(node.left, s); else declareAssign(node.left, s);
        visit(node.right, s); visit(node.body, s); return;
      }
      case "SwitchStatement": { visit(node.discriminant, scope); const s = new Scope(scope, false); for (const c of node.cases) { visit(c.test, s); for (const st of c.consequent) visit(st, s); } return; }
      case "AssignmentExpression": declareAssign(node.left, scope); visit(node.right, scope); return;
      case "ObjectPattern": case "ArrayPattern": case "AssignmentPattern": case "RestElement": declareAssign(node, scope); return;
      default:
        for (const k of Object.keys(node)) {
          if (k === "loc" || k === "type") continue;
          const v = node[k];
          if (Array.isArray(v)) v.forEach((x) => visit(x, scope));
          else if (v && typeof v.type === "string") visit(v, scope);
        }
    }
  }
  // Assignment targets are references (x = 1 writes a free x just as reading it would).
  function declareAssign(p, scope) {
    if (!p) return;
    switch (p.type) {
      case "ObjectPattern": for (const q of p.properties) { if (q.type === "RestElement") declareAssign(q.argument, scope); else { if (q.computed) visit(q.key, scope); declareAssign(q.value, scope); } } return;
      case "ArrayPattern": p.elements.forEach((q) => declareAssign(q, scope)); return;
      case "RestElement": declareAssign(p.argument, scope); return;
      case "AssignmentPattern": declareAssign(p.left, scope); visit(p.right, scope); return;
      default: visit(p, scope);
    }
  }

  for (const st of ast.body) visit(st, top);
  const free = {};
  for (const [n, s, line] of refs) if (!s.has(n) && !(n in free)) free[n] = line;
  return free;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const out = {};
  for (const f of process.argv.slice(2).length ? process.argv.slice(2) : sourceFiles()) out[f] = freeNames(fs.readFileSync(path.join(root, f), "utf8"));
  process.stdout.write(JSON.stringify(out));
}
