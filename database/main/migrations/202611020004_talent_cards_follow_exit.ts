import { defineMigration } from '@nocobase/db';

/**
 * Talent cards created before the exit hook existed still show as active after
 * the employee left. Align them with the employee status; later exits are
 * handled by the change transaction itself.
 */
export default defineMigration({
  name: '202611020004_talent_cards_follow_exit',
  transaction: true,
  irreversible: true,
  async up(context) {
    const cards = context.repository('hrProfiles'),
      employees = await context.repository('personnelEmployees').findMany({
        filter: { status: 'inactive' },
        limit: 100000,
      });
    for (const employee of employees) {
      const card = await cards.findOne({ filter: { personId: String(employee.id) } });
      if (!card || card.status === 'inactive') continue;
      await cards.updateOne({
        filter: { id: String(card.id) },
        values: {
          status: 'inactive',
          revision: Number(card.revision) + 1,
          updatedAt: new Date(),
        },
      });
    }
  },
});
