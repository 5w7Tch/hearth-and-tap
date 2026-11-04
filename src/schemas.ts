// Zod schemas shared by the REST routes (validation + OpenAPI) and the MCP tools (input/output schemas).
import { z } from '@hono/zod-openapi';
import type { ServiceArea } from './domain/area.js';
import type { BookingView } from './domain/booking.js';
import { JOB_TYPES, type Urgency } from './domain/catalogue.js';
import type { Quote } from './domain/pricing.js';
import type { Window } from './domain/windows.js';
import type { AvailabilityResult } from './services/availability.js';
import type { QuoteResult } from './services/quote.js';
import type { ServiceList } from './services/catalogue.js';

export const PostcodeInput = z
  .string()
  .min(1)
  .max(16)
  .openapi({ example: 'SW4 7AA' })
  .describe('Full UK postcode, any casing or spacing');

export const ServiceAreaSchema = z
  .object({
    postcode: z.string().openapi({ example: 'SW4 7AA' }).describe('Normalised postcode'),
    covered: z.boolean().describe('Whether we can send an engineer to this postcode'),
    borough: z.string().nullable().openapi({ example: 'Lambeth' }),
    distanceMiles: z.number().describe('Straight-line distance from our Clapham base, 1 decimal place'),
    travelFeePence: z.number().int().nullable().describe('Travel fee in pence ex VAT; null when not covered'),
    reason: z.enum(['outside_london', 'too_far']).nullable().describe('Why the postcode is not covered; null when covered'),
  })
  .openapi('ServiceArea') satisfies z.ZodType<ServiceArea>;

export const ProblemSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    code: z.string().openapi({ example: 'INVALID_POSTCODE' }),
    detail: z.string(),
  })
  .openapi('Problem');

// ---- Shared inputs ----

export const JobTypeInput = z
  .enum(JOB_TYPES)
  .openapi({ example: 'dripping_tap' })
  .describe('Which job the customer needs. Use list_services to see the options and map the customer\'s description to one of them.');

export const UrgencyInput = z
  .enum(['standard', 'emergency'] satisfies Urgency[])
  .default('standard')
  .openapi({ example: 'standard' })
  .describe('standard (default) or emergency. Emergency is only allowed for jobs with emergencyEligible = true and adds out-of-hours windows and a GBP 40 surcharge.');

export const WindowStartInput = z.iso
  .datetime({ offset: true })
  .openapi({ example: '2026-11-09T08:00:00+00:00' })
  .describe('The start of an arrival window, copied exactly from the start field returned by find_availability.');

export const ReferenceInput = z.string().min(1).max(20).openapi({ example: 'HT-7K3M9Q' }).describe('Booking reference, like HT-7K3M9Q');

export const IdempotencyKeyInput = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,100}$/, 'Use 8-100 letters, digits, dashes or underscores')
  .openapi({ example: 'booking-2026-11-04-abc123' })
  .describe(
    'A unique id you generate once per booking attempt (8-100 characters: letters, digits, - or _). Re-send the SAME key if you retry after an error or timeout, so the customer is never booked twice.',
  );

// ---- Catalogue ----

const PricingSchema = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('hourly'),
      minHours: z.number(),
      maxHours: z.number(),
      partsMinPence: z.number().int(),
      partsMaxPence: z.number().int(),
    }),
    z.object({ kind: z.literal('fixed'), fixedPence: z.number().int() }),
  ])
  .openapi('JobPricing');

export const ServiceListSchema = z
  .object({
    services: z.array(
      z.object({
        jobType: z.enum(JOB_TYPES),
        label: z.string(),
        gasSafeRequired: z.boolean().describe('True when only a Gas Safe registered engineer can do the job'),
        emergencyEligible: z.boolean().describe('True when urgency = emergency is allowed for this job'),
        pricing: PricingSchema,
        pricingBasis: z.string().describe('Customer-ready pricing text with VAT-inclusive prices; quote these to customers, not the raw ex-VAT pricing numbers'),
      }),
    ),
    safetyNotice: z.string().describe('Show this to the customer if they mention gas or carbon monoxide. Never book those.'),
    pricingNote: z.string().describe('Applies to every service: show it once alongside the price list'),
  })
  .openapi('ServiceList') satisfies z.ZodType<ServiceList>;

// ---- Quote ----

export const TierSchema = z.enum(['standard', 'saturday', 'out_of_hours']);

export const QuoteSchema = z
  .object({
    tier: TierSchema.describe('standard = weekday daytime, saturday = x1.25 labour, out_of_hours = x1.5 labour'),
    lineItems: z.array(
      z.object({
        description: z.string(),
        lowPence: z.number().int().describe('Pence ex VAT'),
        highPence: z.number().int().describe('Pence ex VAT'),
      }),
    ),
    subtotalLowPence: z.number().int().describe('Pence ex VAT'),
    subtotalHighPence: z.number().int().describe('Pence ex VAT'),
    vatLowPence: z.number().int(),
    vatHighPence: z.number().int(),
    totalLowPence: z.number().int().describe('Pence including 20% VAT. Divide by 100 for pounds.'),
    totalHighPence: z.number().int().describe('Pence including 20% VAT. Divide by 100 for pounds.'),
    currency: z.literal('GBP'),
    note: z.string(),
  })
  .openapi('Quote') satisfies z.ZodType<Quote>;

export const QuoteRequestShape = {
  jobType: JobTypeInput,
  postcode: PostcodeInput,
  urgency: UrgencyInput,
  windowStart: WindowStartInput.optional(),
};
export const QuoteRequestSchema = z.object(QuoteRequestShape).openapi('QuoteRequest');

export const QuoteResultSchema = QuoteSchema.extend({
  jobType: z.enum(JOB_TYPES),
  jobLabel: z.string(),
  urgency: z.enum(['standard', 'emergency']),
  postcode: z.string(),
  windowStart: z.string().nullable().describe('The window the price is for; null when no window was given'),
  tierNote: z.string().describe('Says which tier the price used and why. Tell the customer when it is only an estimate.'),
}).openapi('QuoteResult') satisfies z.ZodType<QuoteResult>;

// ---- Availability ----

export const WindowSchema = z
  .object({
    start: z.string().openapi({ example: '2026-11-09T08:00:00+00:00' }).describe('Window start, ISO 8601 with London offset. Pass this exactly as windowStart.'),
    end: z.string(),
    label: z.string().openapi({ example: 'Mon 9 Nov, 8–10am' }).describe('Show this to the customer'),
    tier: TierSchema,
  })
  .openapi('Window') satisfies z.ZodType<Window>;

export const AvailabilityQueryShape = {
  jobType: JobTypeInput,
  urgency: UrgencyInput,
  from: z.iso
    .date()
    .optional()
    .openapi({ example: '2026-11-09' })
    .describe('First day to search, YYYY-MM-DD (London). Defaults to today.'),
  days: z.coerce
    .number()
    .int()
    .min(1)
    .max(14)
    .default(7)
    .openapi({ example: 7 })
    .describe('How many days to search, 1-14. Defaults to 7.'),
};

export const AvailabilityResultSchema = z
  .object({
    jobType: z.enum(JOB_TYPES),
    urgency: z.enum(['standard', 'emergency']),
    from: z.string(),
    days: z.number().int(),
    windows: z.array(WindowSchema).describe('Open 2-hour arrival windows in time order. Empty means nothing free: offer another range.'),
  })
  .openapi('Availability') satisfies z.ZodType<AvailabilityResult>;

// ---- Bookings ----

export const BookingBodyShape = {
  jobType: JobTypeInput,
  urgency: UrgencyInput,
  postcode: PostcodeInput,
  addressLine1: z.string().trim().min(1).max(120).openapi({ example: '14 Acre Lane' }).describe('First line of the address'),
  windowStart: WindowStartInput,
  customer: z
    .object({
      name: z.string().trim().min(1).max(80).openapi({ example: 'Sam Carter' }).describe('Customer full name'),
      phone: z.string().min(1).max(30).openapi({ example: '07700 900123' }).describe('UK phone number: 07... or +44...'),
      email: z.email().max(120).optional().describe('Optional email address'),
    })
    .describe('Who we are visiting'),
  problemDescription: z.string().trim().min(1).max(1000).describe('What is wrong, in the customer\'s words'),
};
export const BookingBodySchema = z.object(BookingBodyShape).openapi('BookVisitRequest');

export const BookingSchema = z
  .object({
    reference: z.string().openapi({ example: 'HT-7K3M9Q' }).describe('Give this to the customer'),
    status: z.enum(['confirmed', 'cancelled']),
    jobType: z.enum(JOB_TYPES),
    jobLabel: z.string(),
    urgency: z.enum(['standard', 'emergency']),
    window: WindowSchema,
    engineer: z.object({ firstName: z.string() }),
    postcode: z.string(),
    addressLine1: z.string(),
    customerName: z.string(),
    quote: QuoteSchema,
    cancellableUntil: z.string().describe('The customer can cancel free of charge until this time (2 hours before the window). Still present on cancelled or past bookings; check status first.'),
  })
  .openapi('Booking') satisfies z.ZodType<BookingView>;

export const BookingLookupShape = { reference: ReferenceInput, postcode: PostcodeInput };
