import { Controller, Get, Param } from '@nestjs/common';
import { PublicService } from './public.service';

@Controller('public')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Get('organizations/:organizationSlug')
  getOrganization(@Param('organizationSlug') organizationSlug: string) {
    return this.publicService.getOrganization(organizationSlug);
  }

  @Get('organizations/:organizationSlug/seasons/:seasonSlug')
  getLeagueShell(
    @Param('organizationSlug') organizationSlug: string,
    @Param('seasonSlug') seasonSlug: string,
  ) {
    return this.publicService.getLeagueShell(organizationSlug, seasonSlug);
  }

  @Get('organizations/:organizationSlug/seasons/:seasonSlug/portal')
  getLeaguePortal(
    @Param('organizationSlug') organizationSlug: string,
    @Param('seasonSlug') seasonSlug: string,
  ) {
    return this.publicService.getLeaguePortal(organizationSlug, seasonSlug);
  }
}
