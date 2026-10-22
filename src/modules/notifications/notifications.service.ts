import webpush from 'web-push';
import { prisma } from '../../lib/prisma.js';
import { Role } from '@prisma/client';

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || '';
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || '';
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@bakeryerp.com';

if (vapidPublicKey && vapidPrivateKey) {
  try {
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  } catch (err) {
    console.warn('[WebPush] setVapidDetails init error:', err);
  }
}

export interface SendNotificationPayload {
  userIds: string[];
  branchId?: string | null;
  type: string;
  titleKey: string;
  bodyKey: string;
  variables?: Record<string, any>;
  link?: string;
}

export class NotificationsService {
  /**
   * Save or update a Web Push subscription for a user
   */
  async saveSubscription(
    userId: string,
    sub: { endpoint: string; keys: { p256dh: string; auth: string } },
    userAgent?: string
  ) {
    try {
      if (!sub || !sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
        return { error: 'Invalid push subscription object', status: 400 };
      }

      const existing = await prisma.pushSubscription.findUnique({
        where: { endpoint: sub.endpoint },
      });

      if (existing) {
        await prisma.pushSubscription.update({
          where: { endpoint: sub.endpoint },
          data: {
            userId,
            p256dh: sub.keys.p256dh,
            auth: sub.keys.auth,
            userAgent: userAgent || null,
          },
        });
      } else {
        await prisma.pushSubscription.create({
          data: {
            userId,
            endpoint: sub.endpoint,
            p256dh: sub.keys.p256dh,
            auth: sub.keys.auth,
            userAgent: userAgent || null,
          },
        });
      }

      return { data: { success: true } };
    } catch (err: any) {
      console.error('[NotificationsService] saveSubscription error:', err);
      return { error: err.message || 'Failed to save push subscription', status: 500 };
    }
  }

  /**
   * Unsubscribe / remove push subscription endpoint
   */
  async removeSubscription(endpoint: string) {
    try {
      await prisma.pushSubscription.deleteMany({
        where: { endpoint },
      });
      return { data: { success: true } };
    } catch (err: any) {
      console.error('[NotificationsService] removeSubscription error:', err);
      return { error: err.message || 'Failed to remove push subscription', status: 500 };
    }
  }

  /**
   * Get paginated notifications for a user, including unread count
   */
  async getNotifications(
    userId: string,
    options: { unreadOnly?: boolean; page?: number; limit?: number } = {}
  ) {
    try {
      const page = Math.max(1, options.page || 1);
      const limit = Math.min(100, Math.max(1, options.limit || 20));
      const skip = (page - 1) * limit;

      const where: any = { userId };
      if (options.unreadOnly) {
        where.isRead = false;
      }

      const [items, total, unreadCount] = await Promise.all([
        prisma.notification.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        prisma.notification.count({ where }),
        prisma.notification.count({
          where: { userId, isRead: false },
        }),
      ]);

      const parsedItems = items.map((item) => ({
        ...item,
        variables: item.variables ? JSON.parse(item.variables) : {},
      }));

      return {
        data: {
          items: parsedItems,
          total,
          unreadCount,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (err: any) {
      console.error('[NotificationsService] getNotifications error:', err);
      return { error: err.message || 'Failed to fetch notifications', status: 500 };
    }
  }

  /**
   * Mark a single notification as read
   */
  async markAsRead(userId: string, id: string) {
    try {
      const notification = await prisma.notification.findFirst({
        where: { id, userId },
      });
      if (!notification) {
        return { error: 'Notification not found', status: 404 };
      }

      const updated = await prisma.notification.update({
        where: { id },
        data: { isRead: true },
      });

      return { data: updated };
    } catch (err: any) {
      console.error('[NotificationsService] markAsRead error:', err);
      return { error: err.message || 'Failed to mark notification as read', status: 500 };
    }
  }

  /**
   * Mark all notifications as read for a user
   */
  async markAllAsRead(userId: string) {
    try {
      await prisma.notification.updateMany({
        where: { userId, isRead: false },
        data: { isRead: true },
      });

      return { data: { success: true } };
    } catch (err: any) {
      console.error('[NotificationsService] markAllAsRead error:', err);
      return { error: err.message || 'Failed to mark all as read', status: 500 };
    }
  }

  /**
   * Core dispatch method: persists notification to DB and sends Web Push to mobile / desktop browsers
   */
  async notifyUsers(payload: SendNotificationPayload) {
    const { userIds, branchId, type, titleKey, bodyKey, variables, link } = payload;
    if (!userIds || userIds.length === 0) return;

    const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
    if (uniqueUserIds.length === 0) return;

    try {
      const variablesJson = variables ? JSON.stringify(variables) : null;

      // 1. Bulk insert in DB
      await prisma.notification.createMany({
        data: uniqueUserIds.map((uId) => ({
          userId: uId,
          branchId: branchId || null,
          type,
          titleKey,
          bodyKey,
          variables: variablesJson,
          link: link || '/dashboard',
          isRead: false,
        })),
      });

      // 2. Fetch push subscriptions for these users
      if (vapidPublicKey && vapidPrivateKey) {
        const subscriptions = await prisma.pushSubscription.findMany({
          where: { userId: { in: uniqueUserIds } },
        });

        if (subscriptions.length > 0) {
          const pushPayload = JSON.stringify({
            type,
            titleKey,
            bodyKey,
            variables: variables || {},
            link: link || '/dashboard',
            timestamp: Date.now(),
          });

          // Dispatch web pushes concurrently
          const sendPromises = subscriptions.map(async (sub) => {
            try {
              await webpush.sendNotification(
                {
                  endpoint: sub.endpoint,
                  keys: {
                    p256dh: sub.p256dh,
                    auth: sub.auth,
                  },
                },
                pushPayload,
                {
                  TTL: 24 * 60 * 60, // 1 day
                  urgency: 'high',
                }
              );
            } catch (pushErr: any) {
              // 404 or 410 indicates subscription has expired or unsubscribed
              if (pushErr.statusCode === 404 || pushErr.statusCode === 410) {
                await prisma.pushSubscription.delete({ where: { endpoint: sub.endpoint } }).catch(() => {});
              } else {
                console.warn('[WebPush] Error sending push to endpoint:', pushErr?.message || pushErr);
              }
            }
          });

          await Promise.allSettled(sendPromises);
        }
      }
    } catch (err: any) {
      console.error('[NotificationsService] notifyUsers error:', err);
    }
  }

  /**
   * Helper: Send notification to a specific single user
   */
  async notifyUser(
    userId: string,
    type: string,
    titleKey: string,
    bodyKey: string,
    variables?: Record<string, any>,
    link?: string,
    branchId?: string | null
  ) {
    return this.notifyUsers({
      userIds: [userId],
      branchId,
      type,
      titleKey,
      bodyKey,
      variables,
      link,
    });
  }

  /**
   * Helper: Send notification to all Owners and branch Admins
   */
  async notifyAdminsAndOwners(
    branchId: string | null | undefined,
    type: string,
    titleKey: string,
    bodyKey: string,
    variables?: Record<string, any>,
    link?: string
  ) {
    try {
      const users = await prisma.user.findMany({
        where: {
          isActive: true,
          OR: [
            { role: Role.OWNER },
            {
              role: Role.ADMIN,
              ...(branchId ? { branchId } : {}),
            },
          ],
        },
        select: { id: true },
      });

      const userIds = users.map((u) => u.id);
      await this.notifyUsers({
        userIds,
        branchId,
        type,
        titleKey,
        bodyKey,
        variables,
        link,
      });
    } catch (err) {
      console.error('[NotificationsService] notifyAdminsAndOwners error:', err);
    }
  }

  /**
   * Helper: Notify users by roles in a branch
   */
  async notifyBranchRoles(
    branchId: string | null | undefined,
    roles: Role[],
    type: string,
    titleKey: string,
    bodyKey: string,
    variables?: Record<string, any>,
    link?: string
  ) {
    try {
      const where: any = {
        isActive: true,
        role: { in: roles },
      };
      if (branchId) {
        where.branchId = branchId;
      }

      const users = await prisma.user.findMany({
        where,
        select: { id: true },
      });

      const userIds = users.map((u) => u.id);
      await this.notifyUsers({
        userIds,
        branchId,
        type,
        titleKey,
        bodyKey,
        variables,
        link,
      });
    } catch (err) {
      console.error('[NotificationsService] notifyBranchRoles error:', err);
    }
  }
}

export const notificationsService = new NotificationsService();
