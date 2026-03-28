/**
 * Shared InstantDB schema for Pokémon Park Quest + Curious Comics signup.
 * Push with: npx instant-cli@latest push schema (see INSTANTDB_SCHEMA.md)
 */
import { i } from "https://esm.sh/@instantdb/core";

export const INSTANT_SCHEMA = i.schema({
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
    comic_signups: i.entity({
      childFirstName: i.string().optional(),
      parentEmail: i.string().optional(),
      createdAt: i.number().optional(),
      formSource: i.string().optional(),
    }),
  },
});
