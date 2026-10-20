// Generated from openapi.yaml by scripts/codegen-openapi.ts. Do not edit.
export interface paths {
    "/healthz": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Liveness probe. */
        get: operations["getHealthz"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/readyz": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Readiness probe; checks that Postgres, Redis and MinIO are reachable. */
        get: operations["getReadyz"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/invoices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List invoices, newest first. */
        get: operations["listInvoices"];
        put?: never;
        /**
         * Upload one invoice as a PDF, PNG or JPEG.
         * @description A PNG or JPEG is stored as a one-page PDF. Files are deduplicated by the SHA-256 of the stored PDF. A retry with the same Idempotency-Key and file returns the original invoice id.
         */
        post: operations["createInvoice"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/invoices/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get one invoice. */
        get: operations["getInvoice"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/invoices/{id}/document": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Download the stored PDF of one invoice.
         * @description A PNG or JPEG upload comes back as the one-page PDF it was stored as.
         */
        get: operations["getInvoiceDocument"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/invoice-batches": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Upload up to 500 invoices, each a PDF, PNG or JPEG.
         * @description Every file gets its own result, in request order. A bad file is reported as rejected and never fails the whole batch.
         */
        post: operations["createInvoiceBatch"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/discrepancies": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List discrepancies, newest first. */
        get: operations["listDiscrepancies"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/dead-letters/{id}/replay": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Requeue a dead-lettered job. */
        post: operations["replayDeadLetter"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        Health: {
            /** @constant */
            status: "ok";
        };
        Readiness: {
            /** @enum {string} */
            status: "ok" | "unavailable";
            /** @description Result per dependency, keyed by name. */
            checks: {
                [key: string]: "ok" | "fail";
            };
        };
        /**
         * @description Processing status of an invoice. It moves through received, extracting, extracted and reconciling to reconciled, where each finding waits as an open discrepancy, and ends at approved once every discrepancy has a decision. needs_review means the extraction could not be trusted, such as a carrier or PRO number that matches no shipment; a reviewer then corrects them and matching runs again, approves the invoice, or rejects it. An approval of one whose carrier billed its number before moves it to reconciled instead, with no shipment and the possible duplicate to decide. rejected is final. failed means a step used up its retries; replaying its dead letter restarts that step.
         * @enum {string}
         */
        InvoiceStatus: "received" | "extracting" | "extracted" | "reconciling" | "reconciled" | "needs_review" | "approved" | "rejected" | "failed";
        InvoiceRef: {
            /** Format: uuid */
            id: string;
        };
        Invoice: {
            /** Format: uuid */
            id: string;
            status: components["schemas"]["InvoiceStatus"];
            /** @description Why the invoice failed: the error of the step that used up its retries or met data it cannot process, such as a shipment without miles. Null unless status is failed; a replay clears it. */
            failure_reason: string | null;
            filename: string;
            /** @description SHA-256 of the PDF bytes, hex encoded. */
            content_hash: string;
            /** @description Carrier name; null until extracted. */
            carrier: string | null;
            /** @description Invoice number printed by the carrier. */
            invoice_number: string | null;
            /** Format: date */
            invoice_date: string | null;
            /** @description ISO 4217 code. */
            currency: string | null;
            /**
             * Format: int64
             * @description Invoice total in cents.
             */
            total_cents: number | null;
            /** Format: date-time */
            created_at: string;
        };
        InvoicePage: {
            items: components["schemas"]["Invoice"][];
            /** @description Cursor for the next page; null on the last page. */
            next_cursor: string | null;
        };
        /** @enum {string} */
        DiscrepancyType: "rate_mismatch" | "uncontracted_charge" | "duplicate_charge" | "duplicate_invoice" | "weight_mismatch" | "arithmetic_error";
        /** @enum {string} */
        DiscrepancyStatus: "open" | "confirmed" | "dismissed" | "closed";
        Discrepancy: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            invoice_id: string;
            /**
             * Format: uuid
             * @description Billed line the discrepancy is about, if any.
             */
            line_item_id: string | null;
            /**
             * Format: uuid
             * @description Shipment used as evidence.
             */
            shipment_id: string | null;
            /**
             * Format: uuid
             * @description Rate card version used as evidence.
             */
            rate_card_version_id: string | null;
            type: components["schemas"]["DiscrepancyType"];
            status: components["schemas"]["DiscrepancyStatus"];
            /**
             * Format: int64
             * @description Amount the contract allows, in cents.
             */
            expected_cents: number;
            /**
             * Format: int64
             * @description Amount the carrier billed, in cents.
             */
            billed_cents: number;
            /** @description How the expected amount was derived. */
            evidence: string;
            /** Format: date-time */
            created_at: string;
        };
        DiscrepancyPage: {
            items: components["schemas"]["Discrepancy"][];
            /** @description Cursor for the next page; null on the last page. */
            next_cursor: string | null;
        };
        BatchResult: {
            results: components["schemas"]["BatchItemResult"][];
        };
        BatchItemResult: {
            /** @description Position of the file in the request. */
            index: number;
            /** @enum {string} */
            status: "accepted" | "duplicate" | "rejected";
            /**
             * Format: uuid
             * @description Set when status is accepted or duplicate.
             */
            invoice_id?: string;
            error?: components["schemas"]["Problem"];
        };
        ReplayAccepted: {
            id: string;
            /** @description Id of the requeued job. */
            job_id: string;
        };
        /** @description RFC 9457 Problem Details. */
        Problem: {
            /**
             * Format: uri-reference
             * @description Problem type; about:blank means the HTTP status describes it.
             */
            type: string;
            title: string;
            status: number;
            detail?: string;
            /** Format: uri-reference */
            instance?: string;
        };
    };
    responses: {
        /** @description The request failed validation. */
        BadRequest: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description The X-API-Key header is missing or not a valid key. */
        Unauthorized: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description The API key is valid but may not perform this operation. */
        Forbidden: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description The resource does not exist. */
        NotFound: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description The file is larger than 4 MB (4,194,304 bytes), also once an image is stored as a PDF; a PDF has more than 20 pages; an image is larger than 10,000 pixels a side or 25 megapixels; or the request has more than 500 files. In a batch, such files are rejected one by one instead. */
        PayloadTooLarge: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description The uploaded file is not a readable PDF, PNG or JPEG. */
        UnsupportedMediaType: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description The Idempotency-Key was already used with a different file. */
        IdempotencyKeyReused: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Rate limit exceeded. */
        TooManyRequests: {
            headers: {
                "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                "Retry-After": components["headers"]["RetryAfter"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Ingestion is shedding load or a dependency is down. */
        ServiceUnavailable: {
            headers: {
                "Retry-After": components["headers"]["RetryAfter"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
    };
    parameters: {
        /** @description Client-chosen key that makes retries safe. */
        IdempotencyKey: string;
        /** @description Page size. */
        Limit: number;
        /** @description Opaque cursor taken from next_cursor of the previous page. */
        Cursor: string;
    };
    requestBodies: never;
    headers: {
        /** @description Seconds to wait before retrying. */
        RetryAfter: number;
        /** @description Requests allowed in the current window. */
        RateLimitLimit: number;
        /** @description Requests left in the current window. */
        RateLimitRemaining: number;
    };
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getHealthz: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Service is alive. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Health"];
                };
            };
        };
    };
    getReadyz: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Every dependency is reachable. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Readiness"];
                };
            };
            /** @description At least one dependency is unreachable. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Readiness"];
                };
            };
        };
    };
    listInvoices: {
        parameters: {
            query?: {
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Opaque cursor taken from next_cursor of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Only return invoices with this status. */
                status?: components["schemas"]["InvoiceStatus"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One page of invoices. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvoicePage"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    createInvoice: {
        parameters: {
            query?: never;
            header: {
                /** @description Client-chosen key that makes retries safe. */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": {
                    /** @description Invoice file, at most 4 MB (4,194,304 bytes): a PDF of at most 20 pages, or a PNG or JPEG of at most 10,000 pixels a side and 25 megapixels. */
                    file: Blob;
                };
            };
        };
        responses: {
            /** @description This file was uploaded before; returns the existing invoice id. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvoiceRef"];
                };
            };
            /** @description Invoice stored; extraction is queued. */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvoiceRef"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["IdempotencyKeyReused"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getInvoice: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The invoice. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Invoice"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getInvoiceDocument: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The PDF. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/pdf": Blob;
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    createInvoiceBatch: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": {
                    files: Blob[];
                };
            };
        };
        responses: {
            /** @description Per-file results; accepted files are queued for extraction. */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BatchResult"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            413: components["responses"]["PayloadTooLarge"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listDiscrepancies: {
        parameters: {
            query?: {
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Opaque cursor taken from next_cursor of the previous page. */
                cursor?: components["parameters"]["Cursor"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One page of discrepancies. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DiscrepancyPage"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    replayDeadLetter: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Dead-letter entry id. */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Job requeued. */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReplayAccepted"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
}
