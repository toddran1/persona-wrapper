import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const mobileRoot = path.resolve(import.meta.dirname, "..");
const roots = [path.join(mobileRoot, "app"), path.join(mobileRoot, "src")];
const findings = [];

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(fullPath);
    return entry.isFile() && fullPath.endsWith(".tsx") ? [fullPath] : [];
  });
}

function tagName(node) {
  return node.tagName.getText();
}

function hasAttribute(node, name) {
  return node.attributes.properties.some((property) => (
    ts.isJsxAttribute(property) && property.name.getText() === name
  ));
}

function hasStaticFalseAttribute(node, name) {
  return node.attributes.properties.some((property) => (
    ts.isJsxAttribute(property) &&
    property.name.getText() === name &&
    property.initializer &&
    ts.isJsxExpression(property.initializer) &&
    property.initializer.expression?.kind === ts.SyntaxKind.FalseKeyword
  ));
}

function hasTextChild(node) {
  const element = ts.isJsxOpeningElement(node) && ts.isJsxElement(node.parent) ? node.parent : undefined;
  if (!element) return false;
  let found = false;
  function visit(child) {
    if (found) return;
    if (ts.isJsxElement(child) && tagName(child.openingElement) === "Text") {
      found = true;
      return;
    }
    ts.forEachChild(child, visit);
  }
  element.children.forEach(visit);
  return found;
}

function report(source, node, message) {
  const location = source.getLineAndCharacterOfPosition(node.getStart(source));
  findings.push(`${path.relative(mobileRoot, source.fileName)}:${location.line + 1}:${location.character + 1} ${message}`);
}

for (const fileName of roots.flatMap(sourceFiles)) {
  const source = ts.createSourceFile(fileName, fs.readFileSync(fileName, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const name = tagName(node);
      if (["Pressable", "TouchableOpacity", "TouchableHighlight"].includes(name)) {
        if (!hasAttribute(node, "accessibilityRole")) report(source, node, `${name} is missing accessibilityRole.`);
        if (!hasAttribute(node, "accessibilityLabel") && !hasTextChild(node)) {
          report(source, node, `${name} has no visible Text child or accessibilityLabel.`);
        }
      }
      if (name === "TextInput" && !hasAttribute(node, "accessibilityLabel") && !hasAttribute(node, "accessibilityLabelledBy")) {
        report(source, node, "TextInput is missing accessibilityLabel or accessibilityLabelledBy.");
      }
      if (name === "Image" && !hasAttribute(node, "accessibilityLabel") && !hasStaticFalseAttribute(node, "accessible")) {
        report(source, node, "Image must have accessibilityLabel or accessible={false}.");
      }
      if (name === "Modal" && !hasAttribute(node, "accessibilityViewIsModal")) {
        report(source, node, "Modal is missing accessibilityViewIsModal.");
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

if (findings.length > 0) {
  console.error(`Accessibility audit found ${findings.length} issue(s):\n${findings.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log("Accessibility audit passed for mobile interactive controls, inputs, images, and modals.");
}

