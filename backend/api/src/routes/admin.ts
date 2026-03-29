import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { Request, Response, Router } from 'express';
import { config } from '../config.js';
import {
  PropertyRecord,
  RoomDefinition,
  SubmissionRecord,
  WalkthroughType,
  createId,
  createToken,
  loadDb,
  withDb,
} from './adminStore.js';

export const adminRouter = Router();
export const publicChecklistRouter = Router();

type AuthenticatedRequest = Request & {
  authUser?: {
    id: string;
    email: string;
  };
};

const allowedWalkthroughTypes: WalkthroughType[] = ['movein', 'moveout', 'routine'];

const normalizeEmail = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const hashPassword = (password: string) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
};

const verifyPassword = (password: string, stored: string) => {
  const [salt, expectedHash] = stored.split(':');
  if (!salt || !expectedHash) {
    return false;
  }

  const computedHash = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(expectedHash), Buffer.from(computedHash));
};

const getBearerToken = (authHeader: string | undefined) => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return '';
  }
  return authHeader.slice('Bearer '.length).trim();
};

const toSafeUser = (user: { id: string; email: string; createdAt: string }) => ({
  id: user.id,
  email: user.email,
  createdAt: user.createdAt,
});

const sanitizeRooms = (rooms: unknown): RoomDefinition[] => {
  if (!Array.isArray(rooms)) {
    return [];
  }

  const parsedRooms: RoomDefinition[] = [];

  const sanitizeComponents = (components: unknown) => {
    if (!Array.isArray(components)) {
      return [] as Array<{
        id: string;
        name: string;
        detailFields: string[];
        defaultDetails: Record<string, string>;
        defaultNote: string;
      }>;
    }

    const result: Array<{
      id: string;
      name: string;
      detailFields: string[];
      defaultDetails: Record<string, string>;
      defaultNote: string;
    }> = [];
    for (const component of components as Array<{
      name?: unknown;
      detailFields?: unknown;
      defaultDetails?: unknown;
      defaultNote?: unknown;
    }>) {
      const name = typeof component?.name === 'string' ? component.name.trim() : '';
      if (!name) {
        continue;
      }

      const detailFields = Array.isArray(component?.detailFields)
        ? component.detailFields
            .filter((field: unknown): field is string => typeof field === 'string')
            .map((field: string) => field.trim())
            .filter(Boolean)
        : [];

      const defaultDetails =
        component?.defaultDetails && typeof component.defaultDetails === 'object'
          ? Object.fromEntries(
              Object.entries(component.defaultDetails)
                .filter((entry): entry is [string, string] => {
                  const [key, value] = entry;
                  return typeof key === 'string' && typeof value === 'string' && key.trim().length > 0;
                })
                .map(([key, value]) => [key.trim(), value]),
            )
          : {};

      const defaultNote = typeof component?.defaultNote === 'string' ? component.defaultNote.trim() : '';

      result.push({
        id: createId(),
        name,
        detailFields,
        defaultDetails,
        defaultNote,
      });
    }

    return result;
  };

  for (const item of rooms as Array<{ name?: unknown; spaces?: unknown; components?: unknown }>) {
    const rawName = typeof item?.name === 'string' ? item.name.trim() : '';
    const componentsFromPayload = sanitizeComponents(item?.components);

    const components =
      componentsFromPayload.length > 0
        ? componentsFromPayload
        : Array.isArray(item?.spaces)
          ? item.spaces
              .filter((space: unknown): space is string => typeof space === 'string')
              .map((space: string) => space.trim())
              .filter(Boolean)
              .map((space) => ({
                id: createId(),
                name: space,
                detailFields: [],
                defaultDetails: {},
                defaultNote: '',
              }))
          : [];

    if (!rawName) {
      continue;
    }

    parsedRooms.push({
      id: createId(),
      name: rawName,
      components,
    });
  }

  return parsedRooms;
};

const requireAuth = async (req: AuthenticatedRequest, res: Response, next: () => void) => {
  const token = getBearerToken(req.header('authorization'));
  if (!token) {
    res.status(401).json({ error: 'Missing bearer token.' });
    return;
  }

  const db = await loadDb();
  const session = db.sessions.find((item) => item.token === token);

  if (!session) {
    res.status(401).json({ error: 'Invalid session token.' });
    return;
  }

  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    res.status(401).json({ error: 'Session expired.' });
    return;
  }

  const user = db.users.find((item) => item.id === session.userId);
  if (!user) {
    res.status(401).json({ error: 'Session user not found.' });
    return;
  }

  req.authUser = { id: user.id, email: user.email };
  next();
};

adminRouter.post('/auth/signup', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters.' });
    return;
  }

  const result = await withDb((db) => {
    const existing = db.users.find((user) => user.email === email);
    if (existing) {
      return { error: 'An account with this email already exists.' };
    }

    const now = new Date().toISOString();
    const user = {
      id: createId(),
      email,
      passwordHash: hashPassword(password),
      createdAt: now,
    };
    db.users.push(user);

    const token = createToken();
    const expiresAt = new Date(Date.now() + config.admin.sessionTtlHours * 60 * 60 * 1000).toISOString();
    db.sessions.push({
      id: createId(),
      userId: user.id,
      token,
      expiresAt,
      createdAt: now,
    });

    return {
      token,
      expiresAt,
      user: toSafeUser(user),
    };
  });

  if ('error' in result) {
    res.status(409).json(result);
    return;
  }

  res.status(201).json(result);
});

adminRouter.post('/auth/login', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }

  const result = await withDb((db) => {
    const user = db.users.find((item) => item.email === email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return { error: 'Invalid email or password.' };
    }

    const now = new Date().toISOString();
    const token = createToken();
    const expiresAt = new Date(Date.now() + config.admin.sessionTtlHours * 60 * 60 * 1000).toISOString();
    db.sessions.push({
      id: createId(),
      userId: user.id,
      token,
      expiresAt,
      createdAt: now,
    });

    return {
      token,
      expiresAt,
      user: toSafeUser(user),
    };
  });

  if ('error' in result) {
    res.status(401).json(result);
    return;
  }

  res.status(200).json(result);
});

adminRouter.get('/auth/me', requireAuth, async (req: AuthenticatedRequest, res) => {
  res.status(200).json({ user: req.authUser });
});

adminRouter.get('/properties', requireAuth, async (req: AuthenticatedRequest, res) => {
  const db = await loadDb();
  const properties = db.properties.filter((property) => property.ownerUserId === req.authUser!.id);
  res.status(200).json({ properties });
});

adminRouter.post('/properties', requireAuth, async (req: AuthenticatedRequest, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const address = typeof req.body?.address === 'string' ? req.body.address.trim() : '';
  const rooms = sanitizeRooms(req.body?.rooms);

  if (!name) {
    res.status(400).json({ error: 'Property name is required.' });
    return;
  }

  const now = new Date().toISOString();
  const property = await withDb((db) => {
    const created: PropertyRecord = {
      id: createId(),
      ownerUserId: req.authUser!.id,
      name,
      address,
      rooms,
      createdAt: now,
      updatedAt: now,
    };
    db.properties.push(created);
    return created;
  });

  res.status(201).json({ property });
});

adminRouter.put('/properties/:propertyId', requireAuth, async (req: AuthenticatedRequest, res) => {
  const propertyId = req.params.propertyId;
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const address = typeof req.body?.address === 'string' ? req.body.address.trim() : '';
  const rooms = sanitizeRooms(req.body?.rooms);

  const updated = await withDb((db) => {
    const property = db.properties.find(
      (item) => item.id === propertyId && item.ownerUserId === req.authUser!.id,
    );

    if (!property) {
      return null;
    }

    if (name) {
      property.name = name;
    }
    property.address = address;
    property.rooms = rooms;
    property.updatedAt = new Date().toISOString();
    return property;
  });

  if (!updated) {
    res.status(404).json({ error: 'Property not found.' });
    return;
  }

  res.status(200).json({ property: updated });
});

adminRouter.get('/walkthroughs', requireAuth, async (req: AuthenticatedRequest, res) => {
  const propertyId = typeof req.query.propertyId === 'string' ? req.query.propertyId : '';
  const db = await loadDb();
  const walkthroughs = db.walkthroughs.filter((item) => {
    if (item.ownerUserId !== req.authUser!.id) {
      return false;
    }
    if (propertyId && item.propertyId !== propertyId) {
      return false;
    }
    return true;
  });

  const sharesByWalkthrough = db.walkthroughShares.reduce<Record<string, number>>((acc, share) => {
    acc[share.walkthroughId] = (acc[share.walkthroughId] || 0) + 1;
    return acc;
  }, {});

  const submissionsByWalkthrough = db.submissions.reduce<Record<string, number>>((acc, submission) => {
    acc[submission.walkthroughId] = (acc[submission.walkthroughId] || 0) + 1;
    return acc;
  }, {});

  const data = walkthroughs.map((walkthrough) => ({
    ...walkthrough,
    sharesCount: sharesByWalkthrough[walkthrough.id] || 0,
    submissionsCount: submissionsByWalkthrough[walkthrough.id] || 0,
  }));

  res.status(200).json({ walkthroughs: data });
});

adminRouter.post('/walkthroughs', requireAuth, async (req: AuthenticatedRequest, res) => {
  const propertyId = typeof req.body?.propertyId === 'string' ? req.body.propertyId : '';
  const type = typeof req.body?.type === 'string' ? req.body.type.toLowerCase() : '';

  if (!propertyId || !allowedWalkthroughTypes.includes(type as WalkthroughType)) {
    res.status(400).json({ error: 'Valid propertyId and type are required.' });
    return;
  }

  const result = await withDb((db) => {
    const property = db.properties.find(
      (item) => item.id === propertyId && item.ownerUserId === req.authUser!.id,
    );

    if (!property) {
      return { error: 'Property not found.' };
    }

    const walkthrough = {
      id: createId(),
      ownerUserId: req.authUser!.id,
      propertyId,
      type: type as WalkthroughType,
      createdAt: new Date().toISOString(),
    };

    db.walkthroughs.push(walkthrough);
    return { walkthrough };
  });

  if ('error' in result) {
    res.status(404).json(result);
    return;
  }

  res.status(201).json(result);
});

adminRouter.post('/walkthroughs/:walkthroughId/share', requireAuth, async (req: AuthenticatedRequest, res) => {
  const walkthroughId = req.params.walkthroughId;
  const requestedHours = Number(req.body?.expiresInHours || 24);
  const expiresInHours = Number.isFinite(requestedHours)
    ? Math.max(1, Math.min(72, requestedHours))
    : 24;

  const result = await withDb((db) => {
    const walkthrough = db.walkthroughs.find(
      (item) => item.id === walkthroughId && item.ownerUserId === req.authUser!.id,
    );

    if (!walkthrough) {
      return { error: 'Walkthrough not found.' };
    }

    const now = new Date();
    const share = {
      id: createId(),
      walkthroughId,
      token: createToken(),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + expiresInHours * 60 * 60 * 1000).toISOString(),
    };

    db.walkthroughShares.push(share);
    return { share };
  });

  if ('error' in result) {
    res.status(404).json(result);
    return;
  }

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const checklistUrl = `${baseUrl}/checklist/${result.share.token}`;

  let qrCodeDataUrl = '';
  try {
    qrCodeDataUrl = await QRCode.toDataURL(checklistUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 300,
    });
  } catch {
    qrCodeDataUrl = '';
  }

  res.status(201).json({
    share: result.share,
    checklistUrl,
    qrCodeDataUrl,
  });
});

adminRouter.get('/walkthroughs/:walkthroughId/submissions', requireAuth, async (req: AuthenticatedRequest, res) => {
  const walkthroughId = req.params.walkthroughId;
  const db = await loadDb();
  const walkthrough = db.walkthroughs.find(
    (item) => item.id === walkthroughId && item.ownerUserId === req.authUser!.id,
  );

  if (!walkthrough) {
    res.status(404).json({ error: 'Walkthrough not found.' });
    return;
  }

  const submissions = db.submissions.filter((item) => item.walkthroughId === walkthroughId);
  res.status(200).json({ submissions });
});

publicChecklistRouter.get('/:token', async (req, res) => {
  const token = req.params.token;
  const db = await loadDb();
  const share = db.walkthroughShares.find((item) => item.token === token);

  if (!share) {
    res.status(404).json({ error: 'Checklist link not found.' });
    return;
  }

  if (new Date(share.expiresAt).getTime() <= Date.now()) {
    res.status(410).json({ error: 'Checklist link expired.' });
    return;
  }

  if (share.submittedAt) {
    res.status(409).json({
      error: 'Checklist already submitted and locked.',
      submittedAt: share.submittedAt,
    });
    return;
  }

  const walkthrough = db.walkthroughs.find((item) => item.id === share.walkthroughId);
  if (!walkthrough) {
    res.status(404).json({ error: 'Walkthrough not found.' });
    return;
  }

  const property = db.properties.find((item) => item.id === walkthrough.propertyId);
  if (!property) {
    res.status(404).json({ error: 'Property not found.' });
    return;
  }

  res.status(200).json({
    share: {
      id: share.id,
      token: share.token,
      expiresAt: share.expiresAt,
      createdAt: share.createdAt,
    },
    walkthrough,
    property: {
      id: property.id,
      name: property.name,
      address: property.address,
      rooms: property.rooms,
    },
  });
});

publicChecklistRouter.post('/:token/submissions', async (req, res) => {
  const token = req.params.token;
  const submittedByName = typeof req.body?.submittedByName === 'string' ? req.body.submittedByName.trim() : '';
  const submittedByEmail = normalizeEmail(req.body?.submittedByEmail);
  const results = req.body?.results;

  if (!results || typeof results !== 'object') {
    res.status(400).json({ error: 'results object is required.' });
    return;
  }

  const result = await withDb((db) => {
    const share = db.walkthroughShares.find((item) => item.token === token);
    if (!share) {
      return { status: 404 as const, body: { error: 'Checklist link not found.' } };
    }

    if (new Date(share.expiresAt).getTime() <= Date.now()) {
      return { status: 410 as const, body: { error: 'Checklist link expired.' } };
    }

    if (share.submittedAt) {
      return {
        status: 409 as const,
        body: {
          error: 'Checklist already submitted and locked.',
          submittedAt: share.submittedAt,
        },
      };
    }

    const walkthrough = db.walkthroughs.find((item) => item.id === share.walkthroughId);
    if (!walkthrough) {
      return { status: 404 as const, body: { error: 'Walkthrough not found.' } };
    }

    const submission: SubmissionRecord = {
      id: createId(),
      walkthroughId: walkthrough.id,
      shareId: share.id,
      submittedByName: submittedByName || undefined,
      submittedByEmail: submittedByEmail || undefined,
      results,
      createdAt: new Date().toISOString(),
    };

    db.submissions.push(submission);
    share.submittedAt = submission.createdAt;
    share.submissionId = submission.id;

    return {
      status: 201 as const,
      body: {
        message: 'Checklist submitted successfully. This response is immutable and locked.',
        submission,
      },
    };
  });

  res.status(result.status).json(result.body);
});