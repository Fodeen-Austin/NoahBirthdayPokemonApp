/**
 * InstantDB schema for Pokemon Park Quest.
 * Required for lookup() to work: unique attributes must be declared here and pushed.
 *
 * Push this schema once:
 *   npm install @instantdb/react   # or have it available
 *   echo "INSTANT_APP_ID=your-app-id" > .env   # use instantAppId from data/config.json
 *   npx instant-cli@latest push schema
 */
import { i } from "@instantdb/react";

const _schema = i.schema({
  entities: {
    game_assignments: i.entity({
      slug: i.string().unique().indexed(),
      names: i.json().optional(),
      teams: i.json().optional(),
      updatedAt: i.number().optional(),
    }),
    initial_station_assignment: i.entity({
      slug: i.string().unique().indexed().optional(),
      stationOrder: i.json().optional(),
      updatedAt: i.number().optional(),
    }),
    station_occupancy: i.entity({
      stationId: i.string().unique().indexed(),
      state: i.string().optional(),
      occupiedByTeamId: i.string().optional(),
      occupiedAt: i.number().optional(),
      updatedAt: i.number().optional(),
    }),
    team_statuses: i.entity({
      teamId: i.string().unique().indexed(),
      stepIndex: i.number().optional(),
      completed: i.boolean().optional(),
      updatedAt: i.number().optional(),
    }),
    team_current_assignment: i.entity({
      teamId: i.string().unique().indexed(),
      currentStationId: i.string().optional(),
      assignedAt: i.number().optional(),
      updatedAt: i.number().optional(),
    }),
    team_station_progress: i.entity({
      progressKey: i.string().unique().indexed().optional(),
      teamId: i.string().optional(),
      stationId: i.string().optional(),
      status: i.string().optional(),
      completedAt: i.number().optional(),
      updatedAt: i.number().optional(),
    }),
  },
});

type _AppSchema = typeof _schema;
interface AppSchema extends _AppSchema {}
const schema: AppSchema = _schema;

export type { AppSchema };
export default schema;
