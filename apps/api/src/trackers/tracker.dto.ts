import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsPositive, IsString, Length, Max, MaxLength, Min,
} from 'class-validator';

export const CURRENCIES = ['ILS', 'USD', 'EUR', 'GBP'];

export class TrackerDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsString() @Length(2, 2) originCountry?: string;
  @IsOptional() @IsString() @Length(3, 3) originAirport?: string;
  @IsString() @Length(2, 2) destinationCountry: string;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) destinationAirports?: string[];
  @IsISO8601({ strict: true }) departureDate: string;
  @IsISO8601({ strict: true }) returnDate: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(3) departureFlexDays?: number;
  @IsOptional() @IsIn(['PLUS', 'MINUS', 'BOTH']) departureFlexMode?: 'PLUS' | 'MINUS' | 'BOTH';
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(3) returnFlexDays?: number;
  @IsOptional() @IsIn(['PLUS', 'MINUS', 'BOTH']) returnFlexMode?: 'PLUS' | 'MINUS' | 'BOTH';
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(2) maxStops?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(9) adults?: number;
  @IsOptional() @IsIn(['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST']) cabinClass?: 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST';
  @IsOptional() @IsIn(CURRENCIES) currency?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @IsPositive() targetPrice?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(50) significantChangePct?: number;
}
