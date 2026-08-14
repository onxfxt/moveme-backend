const prisma = require("../db");

/**
 * Given a list of user IDs, returns a map of userId -> { avgRating, ratingCount, completedCount }
 * in a small, fixed number of queries — not one query per job/bid, which
 * would get slow fast on a busy job board.
 *
 * `completedCount` means "completed jobs where this user was the customer"
 * when `as` is "customer", or "completed jobs where this user was the driver"
 * when `as` is "driver".
 */
async function getUserStatsMap(userIds, as) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return {};

  const ratingWhere = { receiverId: { in: ids } };
  const completedWhere = as === "driver" ? { driverId: { in: ids }, status: "COMPLETED" } : { customerId: { in: ids }, status: "COMPLETED" };

  const [ratings, completedJobs] = await Promise.all([
    prisma.rating.findMany({ where: ratingWhere, select: { receiverId: true, stars: true } }),
    prisma.job.findMany({ where: completedWhere, select: { driverId: true, customerId: true } }),
  ]);

  const map = {};
  for (const id of ids) map[id] = { avgRating: null, ratingCount: 0, completedCount: 0, _sum: 0 };

  for (const r of ratings) {
    const m = map[r.receiverId];
    if (!m) continue;
    m._sum += r.stars;
    m.ratingCount += 1;
  }
  for (const j of completedJobs) {
    const id = as === "driver" ? j.driverId : j.customerId;
    const m = map[id];
    if (!m) continue;
    m.completedCount += 1;
  }
  for (const id of ids) {
    if (map[id].ratingCount > 0) map[id].avgRating = Math.round((map[id]._sum / map[id].ratingCount) * 100) / 100;
    delete map[id]._sum;
  }
  return map;
}

module.exports = { getUserStatsMap };
