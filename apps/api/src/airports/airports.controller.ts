import { Controller, Get, Param } from '@nestjs/common';
import { AirportsService } from './airports.service';

@Controller('airports')
export class AirportsController {
  constructor(private airports: AirportsService) {}
  @Get('countries') countries() { return this.airports.countries(); }
  @Get('countries/:code') country(@Param('code') code: string) { return this.airports.country(code); }
}
