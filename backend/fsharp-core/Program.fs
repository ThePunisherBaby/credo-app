namespace CredoOne.Core

open System
open System.Text.Json
open CredoOne.Core.Domain
open CredoOne.Core.PricingKernel
open CredoOne.Core.SecurityGuard

/// Compiled F# CLI/IPC kernel invoked by the Node.js API gateway.
/// Subcommands:
///   credo-core catalog
///   credo-core verify-payment <sku> <cycle> <amountCents>
///   credo-core authorize <role> <permission>
///   credo-core validate-seat <sku> <actorRole> <targetRole> <currentSeats>
///   credo-core validate-campaign <sku> <actorRole> <ctaType> <activeCount> <reqImpressions> <remainingPool> <orgApprovalRequired>
module Program =

    let private writeJson (objValue: obj) =
        let opts = JsonSerializerOptions(PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower)
        Console.WriteLine(JsonSerializer.Serialize(objValue, opts))

    let private verdictToAnon (v: GuardVerdict) =
        match v with
        | Allowed reason ->
            {| allowed = true; code = reason; http_status = 200; message = "OK" |}
        | Denied (code, status, msg) ->
            {| allowed = false; code = code; http_status = status; message = msg |}

    [<EntryPoint>]
    let main argv =
        let cmd = if argv.Length > 0 then argv.[0].Trim().ToLowerInvariant() else "catalog"
        let sealSecret = Environment.GetEnvironmentVariable("JWT_SECRET")

        match cmd with
        | "catalog" ->
            let plansDto =
                allPlans ()
                |> List.map (fun p ->
                    {| sku = p.SkuCode
                       audience = p.AudienceCode
                       display_name = p.DisplayName
                       subtitle = p.Subtitle
                       price_monthly_cents = p.PriceMonthlyCents
                       price_annual_cents = p.PriceAnnualCents
                       is_popular = p.IsPopular
                       is_enterprise = p.IsEnterprise
                       max_seats = p.MaxSeats
                       monthly_impressions = p.MonthlyImpressions
                       max_active_campaigns = p.MaxActiveCampaigns
                       ad_free = p.AdFree
                       can_publish_open = p.CanPublishOpen
                       studio_access = p.StudioAccess
                       approval_workflow = p.ApprovalWorkflow
                       audit_logs_enabled = p.AuditLogsEnabled
                       badge_type = p.BadgeCode
                       sort_order = p.SortOrder
                       features = p.Features |})
            writeJson
                {| engine = "fsharp-compiled-net8"
                   integrity_seal = computeCatalogSeal sealSecret
                   constants =
                       {| min_campaign_allocation = MinCampaignAllocation
                          annual_free_months = AnnualFreeMonths
                          feed_first_slot = FeedInjectionFirstSlotIndex
                          feed_interval = FeedInjectionIntervalPosts
                          max_sponsored_per_page = MaxSponsoredCardsPerPage |}
                   plans = plansDto |}
            0

        | "verify-payment" when argv.Length >= 4 ->
            let amount = match Int32.TryParse(argv.[3]) with | true, v -> v | _ -> -1
            writeJson (verdictToAnon (verifyPaymentIntegrity argv.[1] argv.[2] amount))
            0

        | "authorize" when argv.Length >= 3 ->
            writeJson (verdictToAnon (authorize argv.[1] argv.[2]))
            0

        | "validate-seat" when argv.Length >= 5 ->
            let seats = match Int32.TryParse(argv.[4]) with | true, v -> v | _ -> 0
            writeJson (verdictToAnon (validateSeatInvite argv.[1] argv.[2] argv.[3] seats))
            0

        | "validate-campaign" when argv.Length >= 8 ->
            let activeCnt = match Int32.TryParse(argv.[4]) with | true, v -> v | _ -> 0
            let reqImp = match Int32.TryParse(argv.[5]) with | true, v -> v | _ -> 0
            let remPool = match Int32.TryParse(argv.[6]) with | true, v -> v | _ -> 0
            let approvalReq = String.Equals(argv.[7], "true", StringComparison.OrdinalIgnoreCase)
            let res = validateCampaignCreation argv.[1] argv.[2] argv.[3] activeCnt reqImp remPool approvalReq
            writeJson
                {| allowed = res.Allowed
                   code = res.Code
                   http_status = res.HttpStatus
                   message = res.Message
                   safe_allocated_impressions = res.SafeAllocatedImpressions
                   requires_approval = res.RequiresApproval |}
            0

        | _ ->
            writeJson {| error = "UNKNOWN_KERNEL_COMMAND" |}
            1
