-- CreateEnum
CREATE TYPE "TrackerStatus" AS ENUM ('ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "FlexMode" AS ENUM ('PLUS', 'MINUS', 'BOTH');

-- CreateEnum
CREATE TYPE "CabinClass" AS ENUM ('ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST');

-- CreateEnum
CREATE TYPE "SearchRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCESS', 'NO_RESULTS', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "SearchTrigger" AS ENUM ('SCHEDULED', 'MANUAL', 'INITIAL');

-- CreateEnum
CREATE TYPE "PriceStatus" AS ENUM ('LIVE', 'INDICATIVE');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('DAILY_SUMMARY', 'PRICE_DROP', 'TEST');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "googleId" TEXT,
    "name" TEXT,
    "phone" TEXT,
    "whatsappConsentAt" TIMESTAMP(3),
    "locale" TEXT NOT NULL DEFAULT 'ru',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Jerusalem',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "userId" TEXT NOT NULL,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "whatsappEnabled" BOOLEAN NOT NULL DEFAULT false,
    "dailySummaryEnabled" BOOLEAN NOT NULL DEFAULT true,
    "priceDropAlertEnabled" BOOLEAN NOT NULL DEFAULT true,
    "priceDropAlertPct" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "preferredTime" TEXT NOT NULL DEFAULT '07:00',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Jerusalem',

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "FlightTracker" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT,
    "originCountry" TEXT NOT NULL DEFAULT 'IL',
    "originAirport" TEXT NOT NULL DEFAULT 'TLV',
    "destinationCountry" TEXT NOT NULL,
    "destinationAirports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "departureDate" DATE NOT NULL,
    "returnDate" DATE NOT NULL,
    "departureFlexDays" INTEGER NOT NULL DEFAULT 2,
    "departureFlexMode" "FlexMode" NOT NULL DEFAULT 'PLUS',
    "returnFlexDays" INTEGER NOT NULL DEFAULT 2,
    "returnFlexMode" "FlexMode" NOT NULL DEFAULT 'MINUS',
    "maxStops" INTEGER NOT NULL DEFAULT 1,
    "adults" INTEGER NOT NULL DEFAULT 1,
    "cabinClass" "CabinClass" NOT NULL DEFAULT 'ECONOMY',
    "currency" TEXT NOT NULL DEFAULT 'ILS',
    "targetPrice" DECIMAL(12,2),
    "significantChangePct" DOUBLE PRECISION NOT NULL DEFAULT 2,
    "status" "TrackerStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSearchAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlightTracker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchRun" (
    "id" TEXT NOT NULL,
    "trackerId" TEXT NOT NULL,
    "batchId" TEXT,
    "trigger" "SearchTrigger" NOT NULL DEFAULT 'SCHEDULED',
    "status" "SearchRunStatus" NOT NULL DEFAULT 'QUEUED',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "combinationsChecked" INTEGER NOT NULL DEFAULT 0,
    "providerCallsFailed" INTEGER NOT NULL DEFAULT 0,
    "minPrice" DECIMAL(12,2),
    "currency" TEXT,
    "analysis" JSONB,

    CONSTRAINT "SearchRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlightOffer" (
    "id" TEXT NOT NULL,
    "searchRunId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerOfferId" TEXT,
    "routeKey" TEXT NOT NULL,
    "originAirport" TEXT NOT NULL,
    "destinationAirport" TEXT NOT NULL,
    "departureDate" DATE NOT NULL,
    "returnDate" DATE NOT NULL,
    "airline" TEXT,
    "outboundStops" INTEGER NOT NULL,
    "inboundStops" INTEGER NOT NULL,
    "outboundDurationMin" INTEGER,
    "inboundDurationMin" INTEGER,
    "segments" JSONB,
    "price" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "baggageIncluded" BOOLEAN,
    "baggagePrice" DECIMAL(12,2),
    "fareId" TEXT,
    "bookingUrl" TEXT,
    "priceStatus" "PriceStatus" NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlightOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceSnapshot" (
    "id" TEXT NOT NULL,
    "trackerId" TEXT NOT NULL,
    "searchRunId" TEXT NOT NULL,
    "routeKey" TEXT NOT NULL,
    "destinationAirport" TEXT NOT NULL,
    "departureDate" DATE NOT NULL,
    "returnDate" DATE NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "priceStatus" "PriceStatus" NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyBatch" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "trackersTotal" INTEGER NOT NULL DEFAULT 0,
    "trackersSucceeded" INTEGER NOT NULL DEFAULT 0,
    "trackersFailed" INTEGER NOT NULL DEFAULT 0,
    "uniqueQueries" INTEGER NOT NULL DEFAULT 0,
    "cacheHits" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DailyBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "status" "NotificationStatus" NOT NULL,
    "dedupeKey" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "providerMessageId" TEXT,
    "error" TEXT,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");

-- CreateIndex
CREATE INDEX "FlightTracker_userId_idx" ON "FlightTracker"("userId");

-- CreateIndex
CREATE INDEX "FlightTracker_status_idx" ON "FlightTracker"("status");

-- CreateIndex
CREATE INDEX "SearchRun_trackerId_startedAt_idx" ON "SearchRun"("trackerId", "startedAt");

-- CreateIndex
CREATE INDEX "FlightOffer_searchRunId_price_idx" ON "FlightOffer"("searchRunId", "price");

-- CreateIndex
CREATE INDEX "FlightOffer_routeKey_observedAt_idx" ON "FlightOffer"("routeKey", "observedAt");

-- CreateIndex
CREATE INDEX "PriceSnapshot_trackerId_recordedAt_idx" ON "PriceSnapshot"("trackerId", "recordedAt");

-- CreateIndex
CREATE INDEX "PriceSnapshot_trackerId_routeKey_recordedAt_idx" ON "PriceSnapshot"("trackerId", "routeKey", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationLog_dedupeKey_key" ON "NotificationLog"("dedupeKey");

-- CreateIndex
CREATE INDEX "NotificationLog_userId_sentAt_idx" ON "NotificationLog"("userId", "sentAt");

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlightTracker" ADD CONSTRAINT "FlightTracker_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchRun" ADD CONSTRAINT "SearchRun_trackerId_fkey" FOREIGN KEY ("trackerId") REFERENCES "FlightTracker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchRun" ADD CONSTRAINT "SearchRun_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "DailyBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlightOffer" ADD CONSTRAINT "FlightOffer_searchRunId_fkey" FOREIGN KEY ("searchRunId") REFERENCES "SearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceSnapshot" ADD CONSTRAINT "PriceSnapshot_trackerId_fkey" FOREIGN KEY ("trackerId") REFERENCES "FlightTracker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceSnapshot" ADD CONSTRAINT "PriceSnapshot_searchRunId_fkey" FOREIGN KEY ("searchRunId") REFERENCES "SearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
