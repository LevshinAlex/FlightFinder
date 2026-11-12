-- Prices are only comparable within one set of search criteria (currency, passengers, dates, airports, …).
ALTER TABLE "FlightTracker" ADD COLUMN "criteriaUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Existing trackers keep their full history comparable.
UPDATE "FlightTracker" SET "criteriaUpdatedAt" = "createdAt";
