const os = require('node:os');
const path = require('node:path');
const { promises: fs } = require('node:fs');

async function createTemporaryDirectory(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeFixtureFiles(rootDirectory, files) {
  for (const file of files) {
    const absolutePath = path.join(rootDirectory, file.relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, file.contents ?? 'stub-audio-data');

    if (typeof file.modifiedAtMs === 'number') {
      const timestamp = new Date(file.modifiedAtMs);
      await fs.utimes(absolutePath, timestamp, timestamp);
    }
  }
}

async function listRelativeFiles(rootDirectory) {
  const output = [];

  async function walk(currentDirectory) {
    const entries = await fs.readdir(currentDirectory, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(currentDirectory, entry.name);

      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      output.push(path.relative(rootDirectory, absolutePath));
    }
  }

  await walk(rootDirectory);
  return output.sort();
}

async function cleanupDirectory(directoryPath) {
  await fs.rm(directoryPath, { recursive: true, force: true });
}

module.exports = {
  cleanupDirectory,
  createTemporaryDirectory,
  listRelativeFiles,
  writeFixtureFiles,
};
