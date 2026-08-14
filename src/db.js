const { PrismaClient } = require("@prisma/client");

// A single shared Prisma instance — creating a new one per request exhausts
// database connections under load.
const prisma = global.__prisma || new PrismaClient();
if (process.env.NODE_ENV !== "production") global.__prisma = prisma;

module.exports = prisma;
