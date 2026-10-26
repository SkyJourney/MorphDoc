import fs from "node:fs";
import path from "node:path";

const repositoryDirectory = path.resolve(import.meta.dirname, "..");
const outputDirectory = path.join(repositoryDirectory, "output");

const targets = [path.join(outputDirectory, "docx-release-gate")];

if (fs.existsSync(outputDirectory)) {
  for (const entry of fs.readdirSync(outputDirectory, { withFileTypes: true })) {
    if (entry.isDirectory() && /^docx-release-gate-v/u.test(entry.name)) {
      targets.push(path.join(outputDirectory, entry.name));
    }
  }
}

let removedCount = 0;
for (const target of targets) {
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
    process.stdout.write(`已删除：${path.relative(repositoryDirectory, target)}\n`);
    removedCount += 1;
  }
}

if (removedCount === 0) {
  process.stdout.write("没有找到需要清理的门禁产出目录。\n");
}
