/**
 * Production-ready Swagger/OpenAPI 3.0 spec for Bakery ERP.
 * - Web app: OWNER, ADMIN only.
 * - Mobile app: BAKER, CASHIER, SAMBUSA_WORKER (role-based access).
 * - Login: phone + password (no username).
 */

const roles = {
  web: 'OWNER, ADMIN (web dashboard)',
  mobile: 'BAKER, CASHIER, SAMBUSA_WORKER (mobile app)',
};

export const swaggerSpec = {
  openapi: '3.0.0',
  info: {
    title: 'Bakery ERP API',
    version: '1.0.0',
    description: `
Production API for Bakery ERP. Used by:
- **Web**: Admin/Owner (branches, users, expenses, loans, penalties, payroll). **Analytics** (\`/api/analytics/*\`) is **OWNER only**. All users are staff; salary/billing on User.
- **Mobile**: Baker, Cashier, Sambusa worker (daily sessions, production, leftovers, sales derivation).

**Auth**: All endpoints except \`POST /auth/login\` require \`Authorization: Bearer <token>\`.
**Login**: Use \`phone\` and \`password\` (no username). Phone is the unique user identifier.

**Day/session**: A day opens at 00:00 and ends after 24h. Users can register production, leftovers, etc. for any date (including past). No opening/closing cash.
**Sales**: Sales are not entered manually. Cashier reports leftovers per product; system computes sold = produced - leftover and registers one Sale per session when the day is finalized via \`POST /daily-sessions/:id/finalize\`.
    `.trim(),
  },
  servers: [
    { url: 'http://localhost:3001', description: 'Development' },
    { url: '/api', description: 'Relative (e.g. same host)' },
  ],
  tags: [
    { name: 'Auth', description: 'Login and current user' },
    { name: 'Branches', description: 'Branch management (Web)' },
    { name: 'Users', description: 'User management (Web). All users are staff; salary, startDate, shift, etc. on User' },
    { name: 'Product categories', description: 'Categories (Web)' },
    { name: 'Financial categories', description: 'P&L reporting: REVENUE | EXPENSE (Web OWNER/ADMIN CRUD; all roles can list)' },
    { name: 'Products', description: 'Product catalog' },
    { name: 'Stock items', description: 'Inventory items per branch' },
    { name: 'Stock movements', description: 'IN/OUT/ADJUSTMENT/PRODUCTION_USAGE' },
    { name: 'Production batches', description: 'Production per day (Mobile: Baker)' },
    { name: 'Product conversions', description: 'Convert product A → B (Mobile: Baker)' },
    { name: 'Daily sessions', description: 'One session per branch per calendar day; finalize = save leftovers + compute sales' },
    { name: 'Sales', description: 'Read-only list; sales created by finalize' },
    { name: 'Leftover records', description: 'Per-session leftover quantities (Mobile: Cashier)' },
    { name: 'Suppliers', description: 'Supplier list (Web + Sambusa)' },
    { name: 'Supplier deliveries', description: 'Deliveries; optional link to stock (Web + Sambusa)' },
    { name: 'Expenses', description: 'type COMPANY (operating) | OWNER (withdrawal). Legacy OPERATIONAL/PERSONAL accepted as aliases.' },
    { name: 'Loans', description: 'User (staff) / customer loans (Web)' },
    { name: 'Penalties', description: 'User (staff) penalties (Web)' },
    { name: 'Payroll', description: 'Payroll records (Web)' },
    { name: 'Analytics', description: 'Daily/weekly/monthly reports — **OWNER role only**' },
    { name: 'Dashboard', description: 'Summary stats for home screen (open sessions, today sales, unpaid deliveries, out-of-stock)' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'JWT from POST /auth/login' },
    },
    schemas: {
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'clxx...' },
          fullName: { type: 'string', example: 'Hamza' },
          phone: { type: 'string', example: '0912345678' },
          role: { type: 'string', enum: ['OWNER', 'ADMIN', 'BAKER', 'CASHIER', 'SAMBUSA_WORKER'] },
          branchId: { type: 'string', nullable: true },
          branch: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } },
          filesUrl: { type: 'string', nullable: true },
          shift: { type: 'string', nullable: true },
          salary: { type: 'number', nullable: true },
          startDate: { type: 'string', format: 'date-time', nullable: true },
          isActive: { type: 'boolean' },
        },
      },
      DailySession: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          branchId: { type: 'string' },
          date: { type: 'string', format: 'date' },
          status: { type: 'string', enum: ['OPEN', 'CLOSED'] },
          sales: { type: 'array', items: { $ref: '#/components/schemas/Sale' } },
          leftoverRecords: { type: 'array' },
        },
      },
      Sale: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          sessionId: { type: 'string' },
          totalAmount: { type: 'number' },
          paymentMethod: { type: 'string', enum: ['CASH', 'MOBILE_BANKING'] },
          items: { type: 'array' },
        },
      },
      LeftoverRecord: {
        type: 'object',
        properties: {
          productId: { type: 'string' },
          quantityRemaining: { type: 'integer' },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login with phone and password',
        description: 'Returns JWT and user. Use phone (no username). Roles: OWNER, ADMIN, BAKER, CASHIER, SAMBUSA_WORKER.',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['phone', 'password'],
                properties: {
                  phone: { type: 'string', example: '0912345678', description: 'User phone (unique identifier)' },
                  password: { type: 'string', example: 'password123' },
                },
              },
              example: { phone: '0912345678', password: 'password123' },
            },
          },
        },
        responses: {
          200: {
            description: 'Success',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    token: { type: 'string', description: 'JWT' },
                    user: { $ref: '#/components/schemas/User' },
                  },
                },
                example: {
                  token: 'eyJhbGc...',
                  user: { id: 'clxx...', fullName: 'Hamza', phone: '0912345678', role: 'OWNER', branchId: 'clxx...', branch: { id: 'clxx...', name: 'Main Branch' } },
                },
              },
            },
          },
          400: { description: 'Phone and password required' },
          401: { description: 'Invalid credentials' },
        },
      },
    },
    
    '/api/auth/password': {
      patch: {
        tags: ['Auth'],
        summary: 'Update logged-in user password',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['currentPassword', 'newPassword'],
                properties: {
                  currentPassword: { type: 'string', example: 'old123' },
                  newPassword: { type: 'string', example: 'new123' }
                }
              }
            }
          }
        },
        responses: {
          200: { description: 'Password updated successfully' },
          400: { description: 'Missing fields' },
          401: { description: 'Incorrect current password' },
          404: { description: 'User not found' }
        }
      }
    },
    
  '/api/auth/logout': {
    post: {
      tags: ['Auth'],
      summary: 'Logout current user',
      security: [{ BearerAuth: [] }],
      responses: {
        200: {
          description: 'Logged out successfully'
        }
      }
    }
  },
  
  '/api/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Current user',
        description: 'Returns the authenticated user (Web + Mobile).',
        responses: {
          200: {
            description: 'Authenticated user',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/User' },
                example: { id: 'clxx...', fullName: 'Nebiyu Musbah', phone: '0912345678', role: 'CASHIER', branchId: 'clyy...', branch: { id: 'clyy...', name: 'Main Branch' } },
              },
            },
          },
          401: { description: 'Unauthorized' },
        },
      },
    },
    '/api/branches': {
      get: {
        tags: ['Branches'],
        summary: 'List branches',
        description: `List all branches. ${roles.web}`,
        responses: {
          200: {
            description: 'Array of branches',
            content: {
              'application/json': {
                example: [{ id: 'clxx...', name: 'Main Branch', address: 'Addis Ababa', isActive: true, createdAt: '2025-01-01T00:00:00.000Z' }],
              },
            },
          },
        },
      },
      post: {
        tags: ['Branches'],
        summary: 'Create branch',
        description: `Create a branch. ${roles.web}`,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, address: { type: 'string' } } },
              example: { name: 'Main Branch', address: 'Addis Ababa' },
            },
          },
        },
        responses: {
          201: {
            description: 'Created branch',
            content: { 'application/json': { example: { id: 'clxx...', name: 'Main Branch', address: 'Addis Ababa', isActive: true, createdAt: '2025-01-01T00:00:00.000Z' } } },
          },
        },
      },
    },
    '/api/branches/{id}': {
      get: {
        tags: ['Branches'],
        summary: 'Get branch by ID',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Branch', content: { 'application/json': { example: { id: 'clxx...', name: 'Main Branch', address: 'Addis Ababa', isActive: true, createdAt: '2025-01-01T00:00:00.000Z' } } } } },
      },
      patch: {
        tags: ['Branches'],
        summary: 'Update branch',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object', properties: { name: { type: 'string' }, address: { type: 'string' }, isActive: { type: 'boolean' } } },
              example: { name: 'Main Branch Updated', address: 'New Address' },
            },
          },
        },
        responses: { 200: { description: 'Updated branch', content: { 'application/json': { example: { id: 'clxx...', name: 'Main Branch Updated', address: 'New Address', isActive: true, createdAt: '2025-01-01T00:00:00.000Z' } } } } },
      },
    },
    '/api/users': {
      get: {
        tags: ['Users'],
        summary: 'List users',
        description: `List users, optionally by branch. ${roles.web}`,
        parameters: [{ name: 'branchId', in: 'query', schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'Array of users',
            content: {
              'application/json': {
                example: [{ id: 'clxx...', fullName: 'Ali', phone: '0911111111', role: 'CASHIER', branchId: 'clyy...', branch: { id: 'clyy...', name: 'Main Branch' }, salary: 5000, startDate: '2025-01-01' }],
              },
            },
          },
        },
      },
      post: {
        tags: ['Users'],
        summary: 'Create user',
        description: `Create user with phone (required), fullName, password, role. ${roles.web}`,
        requestBody: {
          content: {
            'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['fullName', 'phone', 'password', 'role'],
                  properties: {
                    fullName: { type: 'string' },
                    phone: { type: 'string', example: '0911111111' },
                    password: { type: 'string' },
                    role: { type: 'string', enum: ['OWNER', 'ADMIN', 'BAKER', 'CASHIER', 'SAMBUSA_WORKER'] },
                    branchId: { type: 'string', nullable: true },
                    salary: { type: 'number', nullable: true },
                    startDate: { type: 'string', format: 'date', nullable: true },
                    lastPaidDate: { type: 'string', format: 'date', nullable: true },
                    shift: { type: 'string', enum: ['DAY', 'NIGHT'], nullable: true },
                    file: { type: 'string', format: 'binary', description: 'User file attachment' },
                  },
                },
                example: { fullName: 'Ali', phone: '0911111111', password: 'secret123', role: 'CASHIER', branchId: 'clxx...', salary: 5000, startDate: '2025-01-01' },
              },
          },
        },
        responses: { 201: { description: 'Created user', content: { 'application/json': { example: { id: 'clxx...', fullName: 'Ali', phone: '0911111111', role: 'CASHIER', branchId: 'clyy...', branch: null } } } } },
      },
    },
    '/api/users/{id}': {
      get: {
        tags: ['Users'],
        summary: 'Get user',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'User', content: { 'application/json': { example: { id: 'clxx...', fullName: 'Ali', phone: '0911111111', role: 'CASHIER', branchId: 'clyy...', branch: { id: 'clyy...', name: 'Main Branch' }, salary: 5000, startDate: '2025-01-01', lastPaidDate: null, shift: 'DAY', filesUrl: null } } } } },
      },
      patch: {
        tags: ['Users'],
        summary: 'Update user',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'multipart/form-data': {
                schema: { type: 'object', properties: { fullName: { type: 'string' }, phone: { type: 'string' }, password: { type: 'string' }, role: { type: 'string' }, branchId: { type: 'string', nullable: true }, isActive: { type: 'boolean' }, salary: { type: 'number' }, startDate: { type: 'string', format: 'date' }, lastPaidDate: { type: 'string', format: 'date' }, shift: { type: 'string' }, file: { type: 'string', format: 'binary', description: 'User file attachment' } } },
                example: { fullName: 'Ali Updated', salary: 5500 },
              },
          },
        },
        responses: { 200: { description: 'Updated user', content: { 'application/json': { example: { id: 'clxx...', fullName: 'Ali Updated', phone: '0911111111', role: 'CASHIER', branchId: 'clyy...', branch: null, salary: 5500 } } } } },
      },
    },
    '/api/daily-sessions': {
      get: {
        tags: ['Daily sessions'],
        summary: 'List daily sessions',
        description: 'Sessions per branch per calendar day. Optional: from, to, status. Flexible: can register for any day (incl. past).',
        parameters: [
          { name: 'branchId', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['OPEN', 'CLOSED'] } },
        ],
        responses: {
          200: {
            description: 'Array of sessions',
            content: {
              'application/json': {
                example: [{ id: 'clxx...', branchId: 'clyy...', date: '2025-03-07', status: 'OPEN', createdAt: '2025-03-07T00:00:00.000Z' }],
              },
            },
          },
        },
      },
      post: {
        tags: ['Daily sessions'],
        summary: 'Create session (open a day)',
        description: 'Create a session for a branch and date. No opening/closing cash. Day = 00:00 to end of day.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['date'], properties: { branchId: { type: 'string' }, date: { type: 'string', format: 'date' } } },
              example: { branchId: 'clxx...', date: '2025-03-07' },
            },
          },
        },
        responses: {
          201: {
            description: 'Created session',
            content: { 'application/json': { example: { id: 'clxx...', branchId: 'clyy...', date: '2025-03-07', status: 'OPEN', createdAt: '2025-03-07T00:00:00.000Z' } } },
          },
        },
      },
    },
    '/api/daily-sessions/{id}': {
      get: {
        tags: ['Daily sessions'],
        summary: 'Get session by ID',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'Session with sales and leftoverRecords',
            content: {
              'application/json': {
                example: {
                  id: 'clxx...',
                  branchId: 'clyy...',
                  date: '2025-03-07',
                  status: 'OPEN',
                  sales: [{ id: 'clyy...', sessionId: 'clxx...', totalAmount: 12500, paymentMethod: 'CASH', items: [] }],
                  leftoverRecords: [{ id: 'clzz...', productId: 'cp1...', quantityRemaining: 5, product: { id: 'cp1...', name: 'Injera', unitType: 'PIECE' } }],
                },
              },
            },
          },
        },
      },
      patch: {
        tags: ['Daily sessions'],
        summary: 'Update session',
        description: 'e.g. set status to CLOSED (usually done via finalize).',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object', properties: { status: { type: 'string', enum: ['OPEN', 'CLOSED'] } } },
              example: { status: 'CLOSED' },
            },
          },
        },
        responses: { 200: { description: 'Updated session', content: { 'application/json': { example: { id: 'clxx...', branchId: 'clyy...', date: '2025-03-07', status: 'CLOSED' } } } } },
      },
    },
    '/api/daily-sessions/{id}/finalize': {
      post: {
        tags: ['Daily sessions'],
        summary: 'Finalize day: save leftovers and compute sales',
        description: `
1. Saves/updates leftover records (productId, quantityRemaining) for the session.
2. Sums production per product for that session's date (from production batches).
3. Computes sold = produced - leftover per product.
4. Creates one Sale with SaleItems (quantity, unitPrice from product.basePrice, subtotal).
5. Closes the session (status = CLOSED).

Call this after the cashier has counted and reported leftovers. Sales are then derived and stored; you get both leftover records and a sales list for that day.
        `.trim(),
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Session ID' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['leftoverRecords'],
                properties: {
                  leftoverRecords: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['productId', 'quantityRemaining'],
                      properties: { productId: { type: 'string' }, quantityRemaining: { type: 'integer', minimum: 0 } },
                    },
                  },
                },
              },
              example: {
                leftoverRecords: [
                  { productId: 'clxx...', quantityRemaining: 5 },
                  { productId: 'clyy...', quantityRemaining: 0 },
                ],
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Updated session (CLOSED) with sales and leftoverRecords',
            content: {
              'application/json': {
                example: {
                  id: 'clxx...',
                  branchId: 'clyy...',
                  date: '2025-03-07',
                  status: 'CLOSED',
                  sales: [{ id: 'clyy...', totalAmount: 12500, paymentMethod: 'CASH' }],
                  leftoverRecords: [{ productId: 'cp1...', quantityRemaining: 5 }],
                },
              },
            },
          },
          400: { description: 'Session already closed or invalid body' },
          404: { description: 'Session not found' },
        },
      },
    },
    '/api/leftover-records': {
      get: {
        tags: ['Leftover records'],
        summary: 'List leftover records by session',
        description: 'Get all leftover records for a session. Query: sessionId (required).',
        parameters: [{ name: 'sessionId', in: 'query', required: true, schema: { type: 'string' }, description: 'Daily session ID' }],
        responses: {
          200: {
            description: 'Array of leftover records with product info',
            content: {
              'application/json': {
                example: [
                  { id: 'clxx...', sessionId: 'clyy...', productId: 'cp1...', quantityRemaining: 5, product: { id: 'cp1...', name: 'Injera', unitType: 'PIECE' } },
                  { id: 'clzz...', sessionId: 'clyy...', productId: 'cp2...', quantityRemaining: 0, product: { id: 'cp2...', name: 'Sambusa', unitType: 'PIECE' } },
                ],
              },
            },
          },
          400: { description: 'sessionId required' },
        },
      },
      post: {
        tags: ['Leftover records'],
        summary: 'Create leftover records for a session',
        description: 'Add leftover records. Body: { sessionId, records: [{ productId, quantityRemaining }] }. Does not replace existing; use PUT /session/:sessionId to replace all.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['sessionId', 'records'],
                properties: {
                  sessionId: { type: 'string' },
                  records: {
                    type: 'array',
                    items: { type: 'object', required: ['productId', 'quantityRemaining'], properties: { productId: { type: 'string' }, quantityRemaining: { type: 'integer' } } },
                  },
                },
              },
              example: { sessionId: 'clyy...', records: [{ productId: 'clxx...', quantityRemaining: 5 }, { productId: 'clzz...', quantityRemaining: 0 }] },
            },
          },
        },
        responses: {
          201: {
            description: 'Created leftover records',
            content: {
              'application/json': {
                example: [
                  { id: 'claa...', sessionId: 'clyy...', productId: 'clxx...', quantityRemaining: 5, product: { id: 'clxx...', name: 'Injera' } },
                ],
              },
            },
          },
          400: { description: 'sessionId and records required' },
          404: { description: 'Session not found' },
        },
      },
    },
    '/api/production-batches': {
      get: {
        tags: ['Production batches'],
        summary: 'List production batches',
        description: `List batches; filter by branchId, date, status. Production has a \`date\` (day it is for); flexible for past days. ${roles.mobile} (Baker).`,
        parameters: [
          { name: 'branchId', in: 'query', schema: { type: 'string' } },
          { name: 'date', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['STARTED', 'COMPLETED'] } },
        ],
        responses: {
          200: {
            description: 'Array of production batches',
            content: {
              'application/json': {
                example: [{ id: 'clxx...', branchId: 'clyy...', date: '2025-03-07', status: 'COMPLETED', items: [{ productId: 'cp1...', quantityProduced: 50 }], createdAt: '2025-03-07T08:00:00.000Z' }],
              },
            },
          },
        },
      },
      post: {
        tags: ['Production batches'],
        summary: 'Create production batch',
        description: 'Record production for a day. Include date (YYYY-MM-DD) for which day; default today. Used to compute sales at finalize.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['items'],
                properties: {
                  branchId: { type: 'string' },
                  date: { type: 'string', format: 'date' },
                  shift: { type: 'string', enum: ['DAY', 'NIGHT'] },
                  items: {
                    type: 'array',
                    items: { type: 'object', required: ['productId', 'quantityProduced'], properties: { productId: { type: 'string' }, quantityProduced: { type: 'integer' } } },
                  },
                  materialUsages: {
                    type: 'array',
                    items: { type: 'object', properties: { stockItemId: { type: 'string' }, quantityUsed: { type: 'number' } } },
                  },
                },
              },
              example: { branchId: 'clyy...', date: '2025-03-07', items: [{ productId: 'clxx...', quantityProduced: 50 }], materialUsages: [{ stockItemId: 'clxx...', quantityUsed: 10 }] },
            },
          },
        },
        responses: {
          201: {
            description: 'Created production batch',
            content: { 'application/json': { example: { id: 'clxx...', branchId: 'clyy...', date: '2025-03-07', status: 'STARTED', items: [], createdAt: '2025-03-07T08:00:00.000Z' } } },
          },
        },
      },
    },
    '/api/production-batches/{id}': {
      get: {
        tags: ['Production batches'],
        summary: 'Get batch',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Production batch', content: { 'application/json': { example: { id: 'clxx...', branchId: 'clyy...', date: '2025-03-07', status: 'COMPLETED', items: [{ productId: 'cp1...', quantityProduced: 50 }], materialUsages: [] } } } } },
      },
      patch: {
        tags: ['Production batches'],
        summary: 'Update batch (e.g. status)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object', properties: { status: { type: 'string', enum: ['STARTED', 'COMPLETED'] } } },
              example: { status: 'COMPLETED' },
            },
          },
        },
        responses: { 200: { description: 'Updated batch', content: { 'application/json': { example: { id: 'clxx...', status: 'COMPLETED' } } } } },
      },
    },
    '/api/leftover-records/session/{sessionId}': {
      put: {
        tags: ['Leftover records'],
        summary: 'Set leftover records for a session',
        description: 'Replace all leftover records for the session. Body: { records: [{ productId, quantityRemaining }] }. Used before or as part of finalize.',
        parameters: [{ name: 'sessionId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['records'],
                properties: {
                  records: {
                    type: 'array',
                    items: { type: 'object', required: ['productId', 'quantityRemaining'], properties: { productId: { type: 'string' }, quantityRemaining: { type: 'integer' } } },
                  },
                },
              },
              example: { records: [{ productId: 'clxx...', quantityRemaining: 5 }, { productId: 'clyy...', quantityRemaining: 0 }] },
            },
          },
        },
        responses: {
          200: {
            description: 'Array of saved leftover records',
            content: {
              'application/json': {
                example: [
                  { id: 'clxx...', sessionId: 'clyy...', productId: 'cp1...', quantityRemaining: 5, product: { id: 'cp1...', name: 'Injera' } },
                ],
              },
            },
          },
          400: { description: 'records required' },
          404: { description: 'Session not found' },
        },
      },
    },
    '/api/sales': {
      get: {
        tags: ['Sales'],
        summary: 'List sales',
        description: 'Sales are created by finalize (derived from production - leftover). List by sessionId or branchId.',
        parameters: [
          { name: 'sessionId', in: 'query', schema: { type: 'string' } },
          { name: 'branchId', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
        ],
        responses: {
          200: {
            description: 'Array of sales',
            content: {
              'application/json': {
                example: [{ id: 'clxx...', sessionId: 'clyy...', totalAmount: 12500, paymentMethod: 'CASH', createdAt: '2025-03-07T18:00:00.000Z', user: { fullName: 'Cashier' }, items: [{ productId: 'cp1...', quantity: 10, unitPrice: 25, subtotal: 250 }] }],
              },
            },
          },
        },
      },
    },
    '/api/sales/{id}': {
      get: {
        tags: ['Sales'],
        summary: 'Get sale by ID',
        description: 'Single sale with session, user, and items (e.g. for receipt or session detail).',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'Sale detail',
            content: {
              'application/json': {
                example: { id: 'clxx...', sessionId: 'clyy...', totalAmount: 12500, paymentMethod: 'CASH', user: { fullName: 'Cashier' }, items: [{ product: { name: 'Injera' }, quantity: 10, unitPrice: 25, subtotal: 250 }] },
              },
            },
          },
          404: { description: 'Sale not found' },
        },
      },
    },
    '/api/product-categories': {
      get: {
        tags: ['Product categories'],
        summary: 'List categories',
        responses: {
          200: {
            description: 'Array of product categories',
            content: { 'application/json': { example: [{ id: 'clxx...', name: 'Bread', type: 'PRODUCED' }] } },
          },
        },
      },
      post: {
        tags: ['Product categories'],
        summary: 'Create category',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['name', 'type'], properties: { name: { type: 'string' }, type: { type: 'string', enum: ['PRODUCED', 'RESELL'] } } },
              example: { name: 'Bread', type: 'PRODUCED' },
            },
          },
        },
        responses: { 201: { description: 'Created category', content: { 'application/json': { example: { id: 'clxx...', name: 'Bread', type: 'PRODUCED' } } } } },
      },
    },
    '/api/product-categories/{id}': {
      get: {
        tags: ['Product categories'],
        summary: 'Get category by ID',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Category with products', content: { 'application/json': { example: { id: 'clxx...', name: 'Bread', type: 'PRODUCED', products: [] } } } } },
      },
      patch: {
        tags: ['Product categories'],
        summary: 'Update category',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string' } } }, example: { name: 'Bread & Pastry' } } } },
        responses: { 200: { description: 'Updated category' } },
      },
    },
    '/api/financial-categories': {
      get: {
        tags: ['Financial categories'],
        summary: 'List financial categories',
        description: 'Optional query type=REVENUE|EXPENSE. All authenticated users.',
        parameters: [{ name: 'type', in: 'query', schema: { type: 'string', enum: ['REVENUE', 'EXPENSE'] } }],
        responses: {
          200: {
            description: 'Array of financial categories',
            content: { 'application/json': { example: [{ id: 'clxx...', name: 'Retail sales (bakery)', type: 'REVENUE', _count: { products: 4, expenses: 0 } }] } },
          },
        },
      },
      post: {
        tags: ['Financial categories'],
        summary: 'Create financial category',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['name', 'type'], properties: { name: { type: 'string' }, type: { type: 'string', enum: ['REVENUE', 'EXPENSE'] } } },
              example: { name: 'Utilities', type: 'EXPENSE' },
            },
          },
        },
        responses: { 201: { description: 'Created', content: { 'application/json': { example: { id: 'clxx...', name: 'Utilities', type: 'EXPENSE' } } } }, 409: { description: 'Duplicate name+type' } },
      },
    },
    '/api/financial-categories/{id}': {
      get: {
        tags: ['Financial categories'],
        summary: 'Get financial category by ID',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Category', content: { 'application/json': { example: { id: 'clxx...', name: 'Retail sales (bakery)', type: 'REVENUE' } } } }, 404: { description: 'Not found' } },
      },
      patch: {
        tags: ['Financial categories'],
        summary: 'Update financial category',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string', enum: ['REVENUE', 'EXPENSE'] } } }, example: { name: 'Rent & facilities' } } } },
        responses: { 200: { description: 'Updated' }, 404: { description: 'Not found' } },
      },
      delete: {
        tags: ['Financial categories'],
        summary: 'Delete financial category',
        description: 'Products/expenses using this category get financialCategoryId cleared (SET NULL).',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 204: { description: 'Deleted' }, 404: { description: 'Not found' } },
      },
    },
    '/api/products': {
      get: {
        tags: ['Products'],
        summary: 'List products',
        parameters: [{ name: 'categoryId', in: 'query', schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'Array of products',
            content: { 'application/json': { example: [{ id: 'clxx...', categoryId: 'clyy...', name: 'Injera', flavor: null, unitType: 'PIECE', basePrice: 25, buyPrice: null }] } },
          },
        },
      },
      post: {
        tags: ['Products'],
        summary: 'Create product',
        description: `Web only. Required: categoryId, name, unitType, basePrice. unitType: PIECE | KG | LITER. Optional financialCategoryId must reference a REVENUE financial category.`,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['categoryId', 'name', 'unitType', 'basePrice'],
                properties: { categoryId: { type: 'string' }, financialCategoryId: { type: 'string', nullable: true }, name: { type: 'string' }, flavor: { type: 'string', nullable: true }, unitType: { enum: ['PIECE', 'KG', 'LITER'] }, basePrice: { type: 'number' }, buyPrice: { type: 'number', nullable: true } },
              },
              example: { categoryId: 'clyy...', financialCategoryId: 'clfc...', name: 'Injera', unitType: 'PIECE', basePrice: 25 },
            },
          },
        },
        responses: { 201: { description: 'Created product', content: { 'application/json': { example: { id: 'clxx...', categoryId: 'clyy...', name: 'Injera', unitType: 'PIECE', basePrice: 25 } } } } },
      },
    },
    '/api/products/{id}': {
      get: {
        tags: ['Products'],
        summary: 'Get product by ID',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Product', content: { 'application/json': { example: { id: 'clxx...', categoryId: 'clyy...', name: 'Injera', flavor: null, unitType: 'PIECE', basePrice: 25, buyPrice: null } } } } },
      },
      patch: {
        tags: ['Products'],
        summary: 'Update product',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: {}, flavor: {}, basePrice: {}, buyPrice: {} } }, example: { basePrice: 30 } } } },
        responses: { 200: { description: 'Updated product' } },
      },
    },
    '/api/stock-items': {
      get: {
        tags: ['Stock items'],
        summary: 'List stock items',
        parameters: [{ name: 'branchId', in: 'query', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'Array of stock items',
            content: { 'application/json': { example: [{ id: 'clxx...', branchId: 'clyy...', name: 'Flour', unitType: 'KG', currentQuantity: 100, minStockLevel: 10 }] } },
          },
        },
      },
      post: {
        tags: ['Stock items'],
        summary: 'Create stock item',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['branchId', 'name', 'unitType'], properties: { branchId: { type: 'string' }, name: { type: 'string' }, unitType: { enum: ['PIECE', 'KG', 'LITER'] }, currentQuantity: { type: 'number' }, minStockLevel: { type: 'number' } } },
              example: { branchId: 'clyy...', name: 'Flour', unitType: 'KG', currentQuantity: 0, minStockLevel: 10 },
            },
          },
        },
        responses: { 201: { description: 'Created stock item', content: { 'application/json': { example: { id: 'clxx...', branchId: 'clyy...', name: 'Flour', unitType: 'KG', currentQuantity: 0, minStockLevel: 10 } } } } },
      },
    },
    '/api/stock-items/{id}': {
      get: {
        tags: ['Stock items'],
        summary: 'Get stock item by ID',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Stock item', content: { 'application/json': { example: { id: 'clxx...', branchId: 'clyy...', name: 'Flour', unitType: 'KG', currentQuantity: 100, minStockLevel: 10 } } } } },
      },
      patch: {
        tags: ['Stock items'],
        summary: 'Update stock item',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: {}, currentQuantity: {}, minStockLevel: {} } }, example: { currentQuantity: 150 } } } },
        responses: { 200: { description: 'Updated stock item' } },
      },
    },
    '/api/stock-movements': {
      get: {
        tags: ['Stock movements'],
        summary: 'List stock movements',
        parameters: [{ name: 'branchId', in: 'query', schema: { type: 'string' } }, { name: 'stockItemId', in: 'query', schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'Array of stock movements',
            content: { 'application/json': { example: [{ id: 'clxx...', stockItemId: 'clyy...', quantity: 50, type: 'IN', reason: 'Delivery', createdAt: '2025-03-07T10:00:00.000Z', stockItem: { name: 'Flour' }, user: { fullName: 'Admin' } }] } },
          },
        },
      },
      post: {
        tags: ['Stock movements'],
        summary: 'Create movement',
        description: 'Type: IN | OUT | ADJUSTMENT | PRODUCTION_USAGE (production usage is also created automatically when recording batch material usage).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['stockItemId', 'quantity', 'type'], properties: { stockItemId: { type: 'string' }, quantity: { type: 'number' }, type: { enum: ['IN', 'OUT', 'ADJUSTMENT', 'PRODUCTION_USAGE'] }, reason: { type: 'string' } } },
              example: { stockItemId: 'clxx...', quantity: 50, type: 'IN', reason: 'Delivery received' },
            },
          },
        },
        responses: { 201: { description: 'Created movement', content: { 'application/json': { example: { id: 'clxx...', stockItemId: 'clyy...', quantity: 50, type: 'IN', reason: 'Delivery received' } } } } },
      },
    },
    '/api/stock-movements/{id}': {
      get: {
        tags: ['Stock movements'],
        summary: 'Get stock movement by ID',
        description: 'Single movement with stockItem and user (audit trail).',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Stock movement', content: { 'application/json': { example: { id: 'clxx...', stockItemId: 'clyy...', quantity: 50, type: 'IN', reason: 'Delivery', stockItem: { name: 'Flour' }, user: { fullName: 'Admin' } } } } },
          404: { description: 'Stock movement not found' },
        },
      },
    },
    '/api/product-conversions': {
      get: {
        tags: ['Product conversions'],
        summary: 'List conversions',
        parameters: [{ name: 'branchId', in: 'query', schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'Array of product conversions',
            content: { 'application/json': { example: [{ id: 'clxx...', branchId: 'clyy...', fromProductId: 'cp1...', toProductId: 'cp2...', fromQuantity: 1, toQuantity: 10, createdAt: '2025-03-07T08:00:00.000Z' }] } },
          },
        },
      },
      post: {
        tags: ['Product conversions'],
        summary: 'Record conversion',
        description: 'e.g. fromQuantity 1, toQuantity 10 (1 unit source = 10 units target).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['fromProductId', 'toProductId', 'fromQuantity', 'toQuantity'], properties: { branchId: { type: 'string' }, fromProductId: { type: 'string' }, toProductId: { type: 'string' }, fromQuantity: { type: 'integer' }, toQuantity: { type: 'integer' } } },
              example: { branchId: 'clyy...', fromProductId: 'cp1...', toProductId: 'cp2...', fromQuantity: 1, toQuantity: 10 },
            },
          },
        },
        responses: { 201: { description: 'Created conversion', content: { 'application/json': { example: { id: 'clxx...', fromProductId: 'cp1...', toProductId: 'cp2...', fromQuantity: 1, toQuantity: 10 } } } } },
      },
    },
    '/api/suppliers': {
      get: {
        tags: ['Suppliers'],
        summary: 'List suppliers',
        parameters: [{ name: 'branchId', in: 'query', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'Array of suppliers',
            content: { 'application/json': { example: [{ id: 'clxx...', branchId: 'clyy...', name: 'Flour Co', phone: '0911111111', type: 'GENERAL' }] } },
          },
        },
      },
      post: {
        tags: ['Suppliers'],
        summary: 'Create supplier',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['branchId', 'name', 'type'], properties: { branchId: { type: 'string' }, name: { type: 'string' }, phone: { type: 'string' }, type: { enum: ['INJERA', 'MILK', 'GENERAL'] } } },
              example: { branchId: 'clyy...', name: 'Flour Co', phone: '0911111111', type: 'GENERAL' },
            },
          },
        },
        responses: { 201: { description: 'Created supplier', content: { 'application/json': { example: { id: 'clxx...', branchId: 'clyy...', name: 'Flour Co', phone: '0911111111', type: 'GENERAL' } } } } },
      },
    },
    '/api/suppliers/{id}': {
      get: {
        tags: ['Suppliers'],
        summary: 'Get supplier by ID',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Supplier', content: { 'application/json': { example: { id: 'clxx...', branchId: 'clyy...', name: 'Flour Co', phone: '0911111111', type: 'GENERAL' } } } } },
      },
      patch: {
        tags: ['Suppliers'],
        summary: 'Update supplier',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: {}, phone: {}, type: {} } }, example: { phone: '0922222222' } } } },
        responses: { 200: { description: 'Updated supplier' } },
      },
    },
    '/api/supplier-deliveries': {
      get: {
        tags: ['Supplier deliveries'],
        summary: 'List deliveries',
        parameters: [{ name: 'supplierId', in: 'query', schema: { type: 'string' } }, { name: 'branchId', in: 'query', schema: { type: 'string' } }, { name: 'isPaid', in: 'query', schema: { type: 'boolean' } }],
        responses: {
          200: {
            description: 'Array of supplier deliveries',
            content: {
              'application/json': {
                example: [{ id: 'clxx...', supplierId: 'clyy...', productId: 'cp1...', quantityReceived: 100, unitBuyPrice: 20, unitSellPrice: 25, isPaid: false, supplier: { name: 'Flour Co' }, product: { name: 'Flour' } }],
              },
            },
          },
        },
      },
      post: {
        tags: ['Supplier deliveries'],
        summary: 'Record delivery',
        description: 'Optional stockItemId: when set, creates a stock IN movement and updates stock quantity.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['supplierId', 'productId', 'quantityReceived', 'unitBuyPrice', 'unitSellPrice'],
                properties: { supplierId: { type: 'string' }, productId: { type: 'string' }, stockItemId: { type: 'string', nullable: true }, quantityReceived: { type: 'integer' }, unitBuyPrice: { type: 'number' }, unitSellPrice: { type: 'number' }, isPaid: { type: 'boolean' }, returnedQuantity: { type: 'integer' } },
              },
              example: { supplierId: 'clyy...', productId: 'cp1...', quantityReceived: 100, unitBuyPrice: 20, unitSellPrice: 25, isPaid: false },
            },
          },
        },
        responses: { 201: { description: 'Created delivery', content: { 'application/json': { example: { id: 'clxx...', supplierId: 'clyy...', productId: 'cp1...', quantityReceived: 100, unitBuyPrice: 20, unitSellPrice: 25, isPaid: false } } } } },
      },
    },
    '/api/supplier-deliveries/{id}': {
      get: {
        tags: ['Supplier deliveries'],
        summary: 'Get delivery by ID',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Delivery', content: { 'application/json': { example: { id: 'clxx...', supplierId: 'clyy...', productId: 'cp1...', quantityReceived: 100, unitBuyPrice: 20, unitSellPrice: 25, isPaid: false, supplier: { name: 'Flour Co' }, product: { name: 'Flour' } } } } },
          404: { description: 'Delivery not found' },
        },
      },
      patch: {
        tags: ['Supplier deliveries'],
        summary: 'Update delivery (e.g. mark paid)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object', properties: { isPaid: { type: 'boolean' }, returnedQuantity: { type: 'integer' } } },
              example: { isPaid: true },
            },
          },
        },
        responses: { 200: { description: 'Updated delivery' } },
      },
    },
    '/api/expenses': {
      get: {
        tags: ['Expenses'],
        summary: 'List expenses',
        description: `Web. Optional: from, to, category.`,
        parameters: [{ name: 'branchId', in: 'query', required: true, schema: { type: 'string' } }, { name: 'from', in: 'query', schema: { type: 'string', format: 'date' } }, { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } }, { name: 'category', in: 'query', schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'Array of expenses',
            content: {
              'application/json': {
                example: [{ id: 'clxx...', branchId: 'clyy...', userId: 'clzz...', type: 'COMPANY', financialCategoryId: 'clfc...', amount: 500, category: 'LUNCH', description: 'Team lunch', date: '2025-03-07', user: { id: 'clzz...', fullName: 'Admin' }, financialCategory: { id: 'clfc...', name: 'Supplies & ingredients', type: 'EXPENSE' } }],
              },
            },
          },
        },
      },
      post: {
        tags: ['Expenses'],
        summary: 'Create expense',
        description: 'type: COMPANY | OWNER (legacy OPERATIONAL→COMPANY, PERSONAL→OWNER). Optional financialCategoryId must be EXPENSE type. category: RENT, SALARY, LUNCH, …',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['amount', 'category'], properties: { branchId: { type: 'string' }, type: { enum: ['COMPANY', 'OWNER', 'OPERATIONAL', 'PERSONAL'] }, financialCategoryId: { type: 'string' }, amount: { type: 'number' }, category: { type: 'string' }, description: { type: 'string' }, date: { type: 'string', format: 'date' } } },
              example: { branchId: 'clyy...', type: 'COMPANY', financialCategoryId: 'clfc...', amount: 500, category: 'LUNCH', description: 'Team lunch', date: '2025-03-07' },
            },
          },
        },
        responses: { 201: { description: 'Created expense', content: { 'application/json': { example: { id: 'clxx...', branchId: 'clyy...', userId: 'clzz...', type: 'COMPANY', amount: 500, category: 'LUNCH', description: 'Team lunch', date: '2025-03-07' } } } } },
      },
    },
    '/api/expenses/{id}': {
      get: {
        tags: ['Expenses'],
        summary: 'Get expense by ID',
        description: 'OWNER/ADMIN only.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Expense', content: { 'application/json': { example: { id: 'clxx...', branchId: 'clyy...', userId: 'clzz...', type: 'COMPANY', amount: 500, category: 'LUNCH', description: 'Team lunch', date: '2025-03-07', user: { fullName: 'Admin', phone: '0912345678' } } } } },
          404: { description: 'Expense not found' },
        },
      },
      patch: {
        tags: ['Expenses'],
        summary: 'Update expense',
        description: 'OWNER/ADMIN only. Can update type, amount, category, description, date.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object', properties: { type: { enum: ['COMPANY', 'OWNER', 'OPERATIONAL', 'PERSONAL'] }, financialCategoryId: { type: 'string', nullable: true }, amount: { type: 'number' }, category: { type: 'string' }, description: { type: 'string' }, date: { type: 'string', format: 'date' } } },
              example: { amount: 600, description: 'Updated description' },
            },
          },
        },
        responses: { 200: { description: 'Updated expense' }, 404: { description: 'Expense not found' } },
      },
    },
    '/api/loans': {
      get: {
        tags: ['Loans'],
        summary: 'List loans',
        description: `Web. Optional type, status.`,
        parameters: [{ name: 'branchId', in: 'query', required: true, schema: { type: 'string' } }, { name: 'type', in: 'query', schema: { type: 'string', enum: ['EMPLOYEE', 'CUSTOMER'] } }, { name: 'status', in: 'query', schema: { type: 'string', enum: ['OPEN', 'PAID'] } }],
        responses: {
          200: {
            description: 'Array of loans',
            content: {
              'application/json': {
                example: [
                  { id: 'clxx...', type: 'EMPLOYEE', userId: 'clyy...', user: { id: 'clyy...', fullName: 'Ali', phone: '0911111111' }, entityId: null, totalAmount: 2000, remainingBalance: 1500, status: 'OPEN' },
                ],
              },
            },
          },
        },
      },
      post: {
        tags: ['Loans'],
        summary: 'Create loan',
        description: 'type EMPLOYEE: require userId (the user/staff who borrowed). type CUSTOMER: require entityId (customer name or phone).',
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object', required: ['type', 'totalAmount'], properties: { branchId: {}, type: { enum: ['EMPLOYEE', 'CUSTOMER'] }, entityId: {}, userId: {}, totalAmount: {} } },
              example: { branchId: 'clxx...', type: 'EMPLOYEE', userId: 'clyy...', totalAmount: 2000 },
            },
          },
        },
        responses: { 201: { description: 'Created loan' } },
      },
    },
    '/api/loans/{id}': {
      get: {
        tags: ['Loans'],
        summary: 'Get loan by ID',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'Loan',
            content: {
              'application/json': {
                example: { id: 'clxx...', type: 'EMPLOYEE', userId: 'clyy...', user: { id: 'clyy...', fullName: 'Ali', phone: '0911111111' }, entityId: null, totalAmount: 2000, remainingBalance: 1500, status: 'OPEN', branchId: 'clzz...', createdAt: '2025-03-01T00:00:00.000Z' },
              },
            },
          },
          404: { description: 'Loan not found' },
        },
      },
    },
    '/api/loans/{id}/pay': {
      post: {
        tags: ['Loans'],
        summary: 'Record loan payment',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['amountPaid'], properties: { amountPaid: { type: 'number' }, date: { type: 'string', format: 'date' } } },
              example: { amountPaid: 500, date: '2025-03-07' },
            },
          },
        },
        responses: {
          200: {
            description: 'Updated loan (remainingBalance reduced)',
            content: {
              'application/json': {
                example: { id: 'clxx...', totalAmount: 2000, remainingBalance: 1000, status: 'OPEN' },
              },
            },
          },
          400: { description: 'Invalid amount or loan already paid' },
          404: { description: 'Loan not found' },
        },
      },
    },
    '/api/penalties': {
      get: {
        tags: ['Penalties'],
        summary: 'List penalties',
        description: `Web. Optional userId, isDeducted.`,
        parameters: [{ name: 'userId', in: 'query', schema: { type: 'string' } }, { name: 'isDeducted', in: 'query', schema: { type: 'boolean' } }],
        responses: { 200: { description: 'Array of penalties', content: { 'application/json': { example: [{ id: 'clxx...', userId: 'clyy...', user: { fullName: 'Ali' }, amount: 100, reason: 'Late', date: '2025-03-01', isDeducted: false }] } } } },
      },
      post: {
        tags: ['Penalties'],
        summary: 'Create penalty',
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object', required: ['userId', 'amount', 'reason'], properties: { userId: {}, amount: {}, reason: {}, date: { type: 'string', format: 'date' } } },
              example: { userId: 'clxx...', amount: 100, reason: 'Late arrival', date: '2025-03-07' },
            },
          },
        },
        responses: { 201: { description: 'Created penalty' } },
      },
    },
    '/api/penalties/{id}': {
      patch: {
        tags: ['Penalties'],
        summary: 'Update penalty (e.g. mark as deducted)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object', properties: { isDeducted: { type: 'boolean' } } },
              example: { isDeducted: true },
            },
          },
        },
        responses: { 200: { description: 'Updated penalty', content: { 'application/json': { example: { id: 'clxx...', userId: 'clyy...', amount: 100, reason: 'Late', date: '2025-03-01', isDeducted: true } } } } },
      },
    },
    '/api/payroll': {
      get: {
        tags: ['Payroll'],
        summary: 'List payroll records',
        description: `Web. Optional userId, month, year.`,
        parameters: [{ name: 'userId', in: 'query', schema: { type: 'string' } }, { name: 'month', in: 'query', schema: { type: 'integer' } }, { name: 'year', in: 'query', schema: { type: 'integer' } }],
        responses: { 200: { description: 'Array of payroll records', content: { 'application/json': { example: [{ id: 'clxx...', userId: 'clyy...', user: { fullName: 'Ali' }, month: 3, year: 2025, baseSalary: 5000, finalAmount: 4800, paymentDate: '2025-03-31' }] } } } },
      },
      post: {
        tags: ['Payroll'],
        summary: 'Create payroll record',
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object', required: ['userId', 'month', 'year', 'baseSalary'], properties: { userId: {}, month: {}, year: {}, baseSalary: {}, loanDeductions: {}, penaltyDeductions: {}, bonus: {}, paymentDate: {} } },
              example: { userId: 'clxx...', month: 3, year: 2025, baseSalary: 5000, loanDeductions: 200, penaltyDeductions: 100, bonus: 0 },
            },
          },
        },
        responses: { 201: { description: 'Created payroll record' } },
      },
    },
    '/api/payroll/calculate/{userId}': {
      get: {
        tags: ['Payroll'],
        summary: 'Calculate payroll for user/month',
        description: 'Uses user.salary and user.startDate; returns suggested amounts (prorated base, loan deductions, penalty deductions, suggestedFinalAmount).',
        parameters: [
          { name: 'userId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'month', in: 'query', required: true, schema: { type: 'integer' } },
          { name: 'year', in: 'query', required: true, schema: { type: 'integer' } },
        ],
        responses: {
          200: {
            description: 'Calculation result',
            content: {
              'application/json': {
                example: { proratedBase: 5000, loanDeductions: 200, penaltyDeductions: 100, suggestedFinalAmount: 4700 },
              },
            },
          },
        },
      },
    },
    '/api/payroll/{id}': {
      get: {
        tags: ['Payroll'],
        summary: 'Get payroll record by ID',
        description: 'Web. Single record with user info.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'Payroll record',
            content: {
              'application/json': {
                example: { id: 'clxx...', userId: 'clyy...', user: { fullName: 'Ali', phone: '0911111111' }, month: 3, year: 2025, baseSalary: 5000, loanDeductions: 200, penaltyDeductions: 100, bonus: 0, finalAmount: 4700, paymentDate: '2025-03-31' },
              },
            },
          },
          404: { description: 'Payroll record not found' },
        },
      },
      patch: {
        tags: ['Payroll'],
        summary: 'Update payroll record',
        description: 'Web. Can update paymentDate, bonus, loanDeductions, penaltyDeductions; finalAmount is recalculated.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object', properties: { paymentDate: { type: 'string', format: 'date', nullable: true }, bonus: { type: 'number' }, loanDeductions: { type: 'number' }, penaltyDeductions: { type: 'number' } } },
              example: { paymentDate: '2025-03-31', bonus: 100 },
            },
          },
        },
        responses: { 200: { description: 'Updated payroll record', content: { 'application/json': { example: { id: 'clxx...', finalAmount: 4800, paymentDate: '2025-03-31', bonus: 100 } } } }, 404: { description: 'Payroll record not found' } },
      },
    },
    '/api/analytics/daily': {
      get: {
        tags: ['Analytics'],
        summary: 'Daily analytics',
        description: `**OWNER role only** (ADMIN receives 403). expenseTotal = COMPANY expenses only (operating); ownerExpenseTotal = OWNER withdrawals. netDaily uses expenseTotal.`,
        parameters: [
          { name: 'branchId', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'date', in: 'query', schema: { type: 'string', format: 'date' }, example: '2025-03-07' },
        ],
        responses: {
          200: {
            description: 'Daily aggregates',
            content: {
              'application/json': {
                example: { date: '2025-03-07', branchId: 'clxx...', sessions: 1, salesCount: 5, salesTotal: 12500, expenseTotal: 500, ownerExpenseTotal: 100, productionBatches: 2, supplierDeliveries: 1, supplierDeliveryCost: 2000, supplierDeliveryRevenue: 2500, netDaily: 12000 },
              },
            },
          },
          403: { description: 'Forbidden — OWNER role required' },
        },
      },
    },
    '/api/analytics/weekly': {
      get: {
        tags: ['Analytics'],
        summary: 'Weekly analytics',
        description: '**OWNER role only.** expenseTotal = COMPANY only; ownerExpenseTotal = OWNER.',
        parameters: [
          { name: 'branchId', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'endDate', in: 'query', schema: { type: 'string', format: 'date', example: '2025-03-07' } },
        ],
        responses: {
          200: {
            description: 'Weekly aggregates',
            content: {
              'application/json': {
                example: { period: 'weekly', from: '2025-03-03', to: '2025-03-07', branchId: 'clxx...', sessionsCount: 5, salesTotal: 85000, expenseTotal: 3500, ownerExpenseTotal: 200, productionBatches: 10, supplierDeliveriesCount: 3, supplierDeliveryCost: 5000, netWeekly: 76500 },
              },
            },
          },
          403: { description: 'Forbidden — OWNER role required' },
        },
      },
    },
    '/api/analytics/monthly': {
      get: {
        tags: ['Analytics'],
        summary: 'Monthly analytics',
        description: '**OWNER role only.** expenseTotal = all expenses; expenseCompanyTotal / expenseOwnerTotal breakdown; payrollTotal; netMonthly.',
        parameters: [
          { name: 'branchId', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'year', in: 'query', schema: { type: 'integer', example: 2025 } },
          { name: 'month', in: 'query', schema: { type: 'integer', example: 3 } },
        ],
        responses: {
          200: {
            description: 'Monthly aggregates',
            content: {
              'application/json': {
                example: { period: 'monthly', year: 2025, month: 3, from: '2025-03-01', to: '2025-03-31', branchId: 'clxx...', sessionsCount: 22, salesTotal: 350000, expenseTotal: 15000, expenseCompanyTotal: 12000, expenseOwnerTotal: 3000, payrollTotal: 25000, productionBatches: 44, supplierDeliveriesCount: 12, supplierDeliveryCost: 40000, netMonthly: 270000 },
              },
            },
          },
          403: { description: 'Forbidden — OWNER role required' },
        },
      },
    },
    '/api/dashboard': {
      get: {
        tags: ['Dashboard'],
        summary: 'Dashboard summary',
        description: 'Summary for web/mobile home: openSessionsCount, todaySalesTotal, unpaidDeliveriesCount, outOfStockCount. Optional query: branchId (defaults to user branch for non-OWNER).',
        parameters: [{ name: 'branchId', in: 'query', schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'Dashboard stats',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    openSessionsCount: { type: 'integer', example: 2 },
                    todaySalesTotal: { type: 'number', example: 12500 },
                    unpaidDeliveriesCount: { type: 'integer', example: 1 },
                    outOfStockCount: { type: 'integer', example: 0 },
                  },
                },
                example: { openSessionsCount: 2, todaySalesTotal: 12500, unpaidDeliveriesCount: 1, outOfStockCount: 0 },
              },
            },
          },
        },
      },
    },
    '/api/health': {
      get: {
        tags: ['Auth'],
        summary: 'Health check',
        security: [],
        responses: {
          200: {
            description: 'Service healthy',
            content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean', example: true } } }, example: { ok: true } } },
          },
        },
      },
    },
  },
} as const;
