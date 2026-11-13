import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import {
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";
import { randomUUID } from "node:crypto";

/** Only these deliberately written messages may reach the operator's terminal. */
export class LocalError extends Error {}

export function outside(root: string, path: string): boolean {
  const location = relative(resolve(root), resolve(path));
  return (
    location === ".." || location.startsWith(".." + sep) || isAbsolute(location)
  );
}

export function privateLocation(project: string, path: string): string {
  path = resolve(path);
  if (!outside(project, path))
    throw new LocalError(
      "Keep local credentials, keys and data outside the repository.",
    );
  if (typeof process.getuid !== "function")
    throw new LocalError(
      "The local spike requires a POSIX filesystem with owner-only permissions.",
    );
  // Containers may map system-owned directories to an unprivileged host UID.
  const systemOwner = lstatSync(parse(path).root).uid;
  let cursor = path;
  while (true) {
    let info;
    try {
      info = lstatSync(cursor);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (info) {
      if (info.isSymbolicLink())
        throw new LocalError("Private paths must not contain symlinks.");
      if (info.uid !== process.getuid() && info.uid !== systemOwner)
        throw new LocalError(
          "Private paths must be owned by you or a system administrator.",
        );
      // A sticky system temporary directory is safe only above the private directory.
      if (
        (info.mode & 0o022) !== 0 &&
        !(info.isDirectory() && info.uid === systemOwner && info.mode & 0o1000)
      )
        throw new LocalError(
          "Private paths must not be writable by other users.",
        );
      const git = join(cursor, ".git");
      if (
        info.isDirectory() &&
        existsSync(git) &&
        (lstatSync(git).isFile() || existsSync(join(git, "HEAD")))
      )
        throw new LocalError(
          "Keep local credentials, keys and data outside every Git checkout.",
        );
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return path;
}

export function privateDirectory(
  project: string,
  path: string,
  create = false,
): string {
  path = privateLocation(project, path);
  if (create) mkdirSync(path, { recursive: true, mode: 0o700 });
  const info = lstatSync(path);
  if (
    !info.isDirectory() ||
    info.uid !== process.getuid!() ||
    (info.mode & 0o077) !== 0
  )
    throw new LocalError(
      "Use an owner-only directory (mode 0700) for local settings and data.",
    );
  return path;
}

export function privateFile(project: string, path: string): string {
  path = privateLocation(project, path);
  privateDirectory(project, dirname(path));
  const info = lstatSync(path);
  if (
    !info.isFile() ||
    info.nlink !== 1 ||
    info.uid !== process.getuid!() ||
    (info.mode & 0o077) !== 0
  )
    throw new LocalError(
      "Use a regular owner-only file (mode 0600), without hard links.",
    );
  return path;
}

export function readPrivate(project: string, path: string): string {
  privateFile(project, path);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(fd);
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      info.uid !== process.getuid!() ||
      (info.mode & 0o077) !== 0 ||
      info.size > 64 * 1024
    )
      throw new LocalError("Invalid private settings file or key.");
    return readFileSync(fd, "utf8");
  } finally {
    closeSync(fd);
  }
}

export function createPrivate(
  project: string,
  path: string,
  content: string,
): void {
  privateLocation(project, path);
  privateDirectory(project, dirname(path), true);
  const fd = openSync(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Atomic replacement; never follows a destination symlink or overwrites a linked file. */
export function replacePrivate(
  project: string,
  path: string,
  content: string,
): void {
  privateLocation(project, path);
  privateDirectory(project, dirname(path));
  if (existsSync(path)) privateFile(project, path);
  const temporary = join(dirname(path), ".beanbag-" + randomUUID());
  try {
    createPrivate(project, temporary, content);
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}
