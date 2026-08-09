import { BadRequestException } from '@nestjs/common';
import {
  assertOneTeamPerSeason,
  assertUniqueTeamIds,
} from './team-assignment-policy.service';

describe('team assignment policy', () => {
  it('rejects duplicate team IDs before querying the database', () => {
    expect(() => assertUniqueTeamIds(['team-1', 'team-1'])).toThrow(
      new BadRequestException('Each team can only be selected once.'),
    );
  });

  it('allows one team in each season', () => {
    expect(() =>
      assertOneTeamPerSeason([
        { id: 'team-1', league_season_id: 'season-1' },
        { id: 'team-2', league_season_id: 'season-2' },
      ]),
    ).not.toThrow();
  });

  it('rejects two teams in the same season', () => {
    expect(() =>
      assertOneTeamPerSeason([
        { id: 'team-1', league_season_id: 'season-1' },
        { id: 'team-2', league_season_id: 'season-1' },
      ]),
    ).toThrow(
      new BadRequestException(
        'A team manager can only manage one team in each season.',
      ),
    );
  });
});
