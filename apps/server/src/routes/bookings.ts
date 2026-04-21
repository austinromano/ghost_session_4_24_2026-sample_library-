import { Hono } from 'hono';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db/index.js';
import { bookings, users, follows, projects, projectMembers } from '../db/schema.js';
import { and, eq, or, inArray, desc } from 'drizzle-orm';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { emitBookingUpdated } from '../ws/index.js';

const bookingsRoutes = new Hono();
bookingsRoutes.use('*', authMiddleware);

const createSchema = z.object({
  inviteeId: z.string().min(1),
  title: z.string().max(120).optional().default(''),
  scheduledAt: z.string().datetime(), // ISO-8601 UTC
  durationMin: z.number().int().min(15).max(8 * 60).default(60),
});

const updateSchema = z.object({
  status: z.enum(['accepted', 'declined', 'canceled']).optional(),
  scheduledAt: z.string().datetime().optional(),
  durationMin: z.number().int().min(15).max(8 * 60).optional(),
  title: z.string().max(120).optional(),
});

async function hydrate(rows: Array<typeof bookings.$inferSelect>) {
  if (rows.length === 0) return [];
  const userIds = [...new Set(rows.flatMap((r) => [r.creatorId, r.inviteeId]))];
  const profiles = await db.select({ id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl })
    .from(users).where(inArray(users.id, userIds)).all();
  const profileMap = new Map(profiles.map((p) => [p.id, p]));
  return rows.map((r) => ({
    ...r,
    creator: profileMap.get(r.creatorId) ?? null,
    invitee: profileMap.get(r.inviteeId) ?? null,
  }));
}

// GET /bookings — every booking involving the current user (as creator or invitee)
bookingsRoutes.get('/', async (c) => {
  const me = c.get('user') as AuthUser;
  const rows = await db.select()
    .from(bookings)
    .where(or(eq(bookings.creatorId, me.id), eq(bookings.inviteeId, me.id)))
    .orderBy(desc(bookings.scheduledAt))
    .limit(500)
    .all();
  return c.json({ success: true, data: await hydrate(rows) });
});

// POST /bookings — invite a friend to a scheduled session
bookingsRoutes.post('/', async (c) => {
  const me = c.get('user') as AuthUser;
  const body = createSchema.parse(await c.req.json());
  if (body.inviteeId === me.id) throw new HTTPException(400, { message: 'Cannot book a session with yourself' });

  // Invitee must exist and the two users must follow each other (friend circle)
  const [invitee] = await db.select({ id: users.id }).from(users).where(eq(users.id, body.inviteeId)).limit(1).all();
  if (!invitee) throw new HTTPException(404, { message: 'Invitee not found' });

  const mutual = await db.select()
    .from(follows)
    .where(or(
      and(eq(follows.followerId, me.id), eq(follows.followingId, body.inviteeId)),
      and(eq(follows.followerId, body.inviteeId), eq(follows.followingId, me.id)),
    ))
    .all();
  if (mutual.length === 0) throw new HTTPException(403, { message: 'You can only book sessions with friends' });

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await db.insert(bookings).values({
    id,
    creatorId: me.id,
    inviteeId: body.inviteeId,
    title: body.title || '',
    scheduledAt: body.scheduledAt,
    durationMin: body.durationMin,
    status: 'pending',
    createdAt,
  }).run();

  const [row] = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1).all();
  const [hydrated] = await hydrate([row]);
  emitBookingUpdated([me.id, body.inviteeId], 'created', id, hydrated);
  return c.json({ success: true, data: hydrated });
});

// PATCH /bookings/:id — update status/time/title. Creator can edit anything;
// invitee can only change status (accept/decline).
bookingsRoutes.patch('/:id', async (c) => {
  const me = c.get('user') as AuthUser;
  const id = c.req.param('id');
  const body = updateSchema.parse(await c.req.json());

  const [existing] = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1).all();
  if (!existing) throw new HTTPException(404, { message: 'Booking not found' });

  const isCreator = existing.creatorId === me.id;
  const isInvitee = existing.inviteeId === me.id;
  if (!isCreator && !isInvitee) throw new HTTPException(403, { message: 'Not your booking' });

  const patch: Partial<typeof bookings.$inferInsert> = {};
  if (body.status !== undefined) {
    // Invitees can accept/decline; only creator can cancel.
    if (body.status === 'canceled' && !isCreator) {
      throw new HTTPException(403, { message: 'Only the creator can cancel' });
    }
    if ((body.status === 'accepted' || body.status === 'declined') && !isInvitee) {
      throw new HTTPException(403, { message: 'Only the invitee can accept or decline' });
    }
    patch.status = body.status;
  }
  if (isCreator) {
    if (body.scheduledAt !== undefined) patch.scheduledAt = body.scheduledAt;
    if (body.durationMin !== undefined) patch.durationMin = body.durationMin;
    if (body.title !== undefined) patch.title = body.title;
  }

  // On first acceptance, spin up a shared project so both users have a room
  // to join when the session starts.
  if (body.status === 'accepted' && !existing.projectId) {
    const projectId = crypto.randomUUID();
    const now = new Date().toISOString();
    const projName = existing.title?.trim() || `Session with ${me.displayName}`;
    await db.insert(projects).values({
      id: projectId,
      name: projName,
      description: `Auto-created from a scheduled session on ${new Date(existing.scheduledAt).toLocaleString()}`,
      ownerId: existing.creatorId,
      tempo: 0,
      key: '',
      genre: '',
      projectType: 'project',
      timeSignature: '',
      createdAt: now,
      updatedAt: now,
    }).run();
    // Both participants are editors on the shared project.
    await db.insert(projectMembers).values([
      { projectId, userId: existing.creatorId, role: 'owner', joinedAt: now },
      { projectId, userId: existing.inviteeId, role: 'editor', joinedAt: now },
    ]).run();
    patch.projectId = projectId;
  }

  if (Object.keys(patch).length === 0) {
    return c.json({ success: true, data: (await hydrate([existing]))[0] });
  }

  await db.update(bookings).set(patch).where(eq(bookings.id, id)).run();
  const [updated] = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1).all();
  const [hydrated] = await hydrate([updated]);
  emitBookingUpdated([existing.creatorId, existing.inviteeId], 'updated', id, hydrated);
  return c.json({ success: true, data: hydrated });
});

// DELETE /bookings/:id — hard delete. Only the creator may delete.
bookingsRoutes.delete('/:id', async (c) => {
  const me = c.get('user') as AuthUser;
  const id = c.req.param('id');
  const [existing] = await db.select({ creatorId: bookings.creatorId, inviteeId: bookings.inviteeId }).from(bookings).where(eq(bookings.id, id)).limit(1).all();
  if (!existing) throw new HTTPException(404, { message: 'Booking not found' });
  if (existing.creatorId !== me.id) throw new HTTPException(403, { message: 'Only the creator can delete' });
  await db.delete(bookings).where(eq(bookings.id, id)).run();
  emitBookingUpdated([existing.creatorId, existing.inviteeId], 'deleted', id);
  return c.json({ success: true });
});

export default bookingsRoutes;
