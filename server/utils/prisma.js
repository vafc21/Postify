const { PrismaClient } = require('@prisma/client');

// Singleton pattern to prevent multiple PrismaClient instances
// from exhausting the database connection pool.
const prisma = global.__prisma || new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}

module.exports = prisma;
