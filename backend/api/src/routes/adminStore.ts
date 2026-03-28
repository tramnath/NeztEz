import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

export type RoomDefinition = {
  id: string;
  name: string;
  components: Array<{
    id: string;
    name: string;
    detailFields: string[];
  }>;
};

export type UserRecord = {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
};

export type SessionRecord = {
  id: string;
  userId: string;
  token: string;
  expiresAt: string;
  createdAt: string;
};

export type PropertyRecord = {
  id: string;
  ownerUserId: string;
  name: string;
  address: string;
  rooms: RoomDefinition[];
  createdAt: string;
  updatedAt: string;
};

export type WalkthroughType = 'movein' | 'moveout' | 'routine';

export type WalkthroughRecord = {
  id: string;
  ownerUserId: string;
  propertyId: string;
  type: WalkthroughType;
  createdAt: string;
};

export type WalkthroughShareRecord = {
  id: string;
  walkthroughId: string;
  token: string;
  expiresAt: string;
  createdAt: string;
  submittedAt?: string;
  submissionId?: string;
};

export type SubmissionRecord = {
  id: string;
  walkthroughId: string;
  shareId: string;
  submittedByName?: string;
  submittedByEmail?: string;
  results: unknown;
  createdAt: string;
};

type AdminDb = {
  users: UserRecord[];
  sessions: SessionRecord[];
  properties: PropertyRecord[];
  walkthroughs: WalkthroughRecord[];
  walkthroughShares: WalkthroughShareRecord[];
  submissions: SubmissionRecord[];
};

type AuthDb = {
  users: UserRecord[];
  sessions: SessionRecord[];
};

type WorkflowDb = {
  walkthroughs: WalkthroughRecord[];
  walkthroughShares: WalkthroughShareRecord[];
  submissions: SubmissionRecord[];
};

const createEmptyDb = (): AdminDb => ({
  users: [],
  sessions: [],
  properties: [],
  walkthroughs: [],
  walkthroughShares: [],
  submissions: [],
});

const createEmptyAuthDb = (): AuthDb => ({
  users: [],
  sessions: [],
});

const createEmptyWorkflowDb = (): WorkflowDb => ({
  walkthroughs: [],
  walkthroughShares: [],
  submissions: [],
});

const dbFilePath = path.resolve(config.admin.dataFilePath);
const dataDirPath = path.dirname(dbFilePath);
const authFilePath = path.join(dataDirPath, 'admin-auth.json');
const workflowFilePath = path.join(dataDirPath, 'admin-workflows.json');
const propertiesDirPath = path.join(dataDirPath, 'properties');
let writeQueue = Promise.resolve();

const fileExists = async (filePath: string) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const writeJsonAtomic = async (filePath: string, value: unknown) => {
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(tempPath, filePath);
};

const readJson = async <T>(filePath: string, fallback: T): Promise<T> => {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const propertyFilePath = (propertyId: string) =>
  path.join(propertiesDirPath, `${encodeURIComponent(propertyId)}.json`);

const normalizeAuthDb = (value: Partial<AuthDb> | undefined): AuthDb => ({
  users: value?.users || [],
  sessions: value?.sessions || [],
});

const normalizeWorkflowDb = (value: Partial<WorkflowDb> | undefined): WorkflowDb => ({
  walkthroughs: value?.walkthroughs || [],
  walkthroughShares: value?.walkthroughShares || [],
  submissions: value?.submissions || [],
});

const normalizeAdminDb = (value: Partial<AdminDb> | undefined): AdminDb => ({
  users: value?.users || [],
  sessions: value?.sessions || [],
  properties: value?.properties || [],
  walkthroughs: value?.walkthroughs || [],
  walkthroughShares: value?.walkthroughShares || [],
  submissions: value?.submissions || [],
});

const migrateLegacyDbIfNeeded = async () => {
  const authExists = await fileExists(authFilePath);
  const workflowExists = await fileExists(workflowFilePath);

  let propertyEntries: string[] = [];
  try {
    propertyEntries = await fs.readdir(propertiesDirPath);
  } catch {
    propertyEntries = [];
  }

  const hasPropertyFiles = propertyEntries.some((entry) => entry.endsWith('.json'));
  if (authExists || workflowExists || hasPropertyFiles) {
    return;
  }

  if (!(await fileExists(dbFilePath))) {
    return;
  }

  const legacyRaw = await readJson<Partial<AdminDb>>(dbFilePath, createEmptyDb());
  const legacy = normalizeAdminDb(legacyRaw);

  await writeJsonAtomic(authFilePath, {
    users: legacy.users,
    sessions: legacy.sessions,
  } satisfies AuthDb);

  await writeJsonAtomic(workflowFilePath, {
    walkthroughs: legacy.walkthroughs,
    walkthroughShares: legacy.walkthroughShares,
    submissions: legacy.submissions,
  } satisfies WorkflowDb);

  for (const property of legacy.properties) {
    await writeJsonAtomic(propertyFilePath(property.id), property);
  }
};

export const ensureDbExists = async () => {
  await fs.mkdir(dataDirPath, { recursive: true });
  await fs.mkdir(propertiesDirPath, { recursive: true });

  await migrateLegacyDbIfNeeded();

  if (!(await fileExists(authFilePath))) {
    await writeJsonAtomic(authFilePath, createEmptyAuthDb());
  }

  if (!(await fileExists(workflowFilePath))) {
    await writeJsonAtomic(workflowFilePath, createEmptyWorkflowDb());
  }
};

const readDb = async (): Promise<AdminDb> => {
  await ensureDbExists();

  const authRaw = await readJson<Partial<AuthDb>>(authFilePath, createEmptyAuthDb());
  const workflowRaw = await readJson<Partial<WorkflowDb>>(workflowFilePath, createEmptyWorkflowDb());

  let propertyFiles: string[] = [];
  try {
    propertyFiles = await fs.readdir(propertiesDirPath);
  } catch {
    propertyFiles = [];
  }

  const properties: PropertyRecord[] = [];
  for (const fileName of propertyFiles) {
    if (!fileName.endsWith('.json')) {
      continue;
    }

    const property = await readJson<PropertyRecord | null>(
      path.join(propertiesDirPath, fileName),
      null,
    );

    if (property && typeof property.id === 'string' && property.id.length > 0) {
      properties.push(property);
    }
  }

  const auth = normalizeAuthDb(authRaw);
  const workflows = normalizeWorkflowDb(workflowRaw);

  return {
    users: auth.users,
    sessions: auth.sessions,
    properties,
    walkthroughs: workflows.walkthroughs,
    walkthroughShares: workflows.walkthroughShares,
    submissions: workflows.submissions,
  };
};

const writeDb = async (db: AdminDb) => {
  await ensureDbExists();

  await writeJsonAtomic(authFilePath, {
    users: db.users,
    sessions: db.sessions,
  } satisfies AuthDb);

  await writeJsonAtomic(workflowFilePath, {
    walkthroughs: db.walkthroughs,
    walkthroughShares: db.walkthroughShares,
    submissions: db.submissions,
  } satisfies WorkflowDb);

  const expectedPropertyFilePaths = new Set<string>();
  for (const property of db.properties) {
    const filePath = propertyFilePath(property.id);
    expectedPropertyFilePaths.add(filePath);
    await writeJsonAtomic(filePath, property);
  }

  let propertyFiles: string[] = [];
  try {
    propertyFiles = await fs.readdir(propertiesDirPath);
  } catch {
    propertyFiles = [];
  }

  for (const fileName of propertyFiles) {
    if (!fileName.endsWith('.json')) {
      continue;
    }

    const filePath = path.join(propertiesDirPath, fileName);
    if (!expectedPropertyFilePaths.has(filePath)) {
      await fs.unlink(filePath);
    }
  }
};

export const withDb = async <T>(updater: (db: AdminDb) => T | Promise<T>): Promise<T> => {
  const run = async () => {
    const db = await readDb();
    const result = await updater(db);
    await writeDb(db);
    return result;
  };

  const chained = writeQueue.then(run, run);
  writeQueue = chained.then(
    () => undefined,
    () => undefined,
  );
  return chained;
};

export const loadDb = async () => {
  return readDb();
};

export const createId = () => crypto.randomUUID();

export const createToken = () => crypto.randomBytes(24).toString('base64url');