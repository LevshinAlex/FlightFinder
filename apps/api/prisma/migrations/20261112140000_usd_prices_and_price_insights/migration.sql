-- All prices are kept in one base currency (USD). Quotes in another currency are converted;
-- the provider's own price is kept here.
ALTER TABLE "FlightOffer" ADD COLUMN "originalPrice" DECIMAL(12,2);
ALTER TABLE "FlightOffer" ADD COLUMN "originalCurrency" TEXT;

-- Google Flights price insight of the search (low | typical | high + usual range).
ALTER TABLE "FlightOffer" ADD COLUMN "priceLevel" TEXT;
ALTER TABLE "FlightOffer" ADD COLUMN "typicalPriceLow" DECIMAL(12,2);
ALTER TABLE "FlightOffer" ADD COLUMN "typicalPriceHigh" DECIMAL(12,2);

-- New trackers are in USD. Existing ones are converted (target price at the current rate) by the API
-- on start – a SQL migration has no exchange rates.
ALTER TABLE "FlightTracker" ALTER COLUMN "currency" SET DEFAULT 'USD';
