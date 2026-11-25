namespace CredoOne.Core

open CredoOne.Core.Domain
open CredoOne.Core.PricingKernel

/// Exhaustive compile-time verified RBAC, Payment Integrity, Quota Enforcement,
/// and Enterprise Approval Workflow security guards.
module SecurityGuard =

    let rolePermissions (role: OrgRole) : Set<string> =
        match role with
        | Owner ->
            set [ "billing:manage"; "org:delete"; "org:settings"; "team:manage_admins"; "team:manage_members"
                  "campaign:approve"; "campaign:publish"; "campaign:draft"; "campaign:toggle"
                  "community:moderate"; "analytics:read"; "analytics:export"; "audit:read" ]
        | Admin ->
            set [ "org:settings"; "team:manage_members"; "campaign:approve"; "campaign:publish"
                  "campaign:draft"; "campaign:toggle"; "community:moderate"; "analytics:read"
                  "analytics:export"; "audit:read" ]
        | Editor ->
            set [ "campaign:draft"; "campaign:publish"; "analytics:read" ]
        | Moderator ->
            set [ "community:moderate"; "analytics:read" ]
        | Analyst ->
            set [ "analytics:read"; "analytics:export" ]

    let authorize (roleStr: string) (permission: string) : GuardVerdict =
        match parseOrgRole roleStr with
        | None -> Denied("INVALID_ROLE", 403, "Rol de organización inválido.")
        | Some role ->
            if (rolePermissions role).Contains(permission) then
                Allowed("RBAC_OK")
            else
                Denied("RBAC_PERMISSION_DENIED", 403, sprintf "Tu rol (%s) no tiene permiso para %s." roleStr permission)

    /// Verifies that a PayPal subscription confirmation or webhook sale matches the
    /// exact immutable F# cent price and never permits client-tampered underpayment.
    let verifyPaymentIntegrity (skuCode: string) (cycleCode: string) (reportedAmountCents: int) : GuardVerdict =
        match parsePlanSku skuCode, parseBillingCycle cycleCode with
        | None, _ -> Denied("UNKNOWN_SKU", 404, "SKU de plan Credo One no reconocido por el núcleo F#.")
        | _, None -> Denied("INVALID_CYCLE", 400, "Ciclo de facturación inválido.")
        | Some sku, Some cycle ->
            match tryGetPlan sku with
            | None -> Denied("UNKNOWN_SKU", 404, "Plan no encontrado.")
            | Some spec ->
                if spec.IsEnterprise && cycle <> Custom then
                    Denied("ENTERPRISE_CUSTOM_BILLING", 403, "Credo One Enterprise requiere contratación corporativa.")
                else
                    let expected = expectedAmountCents spec cycle
                    if reportedAmountCents >= 0 && reportedAmountCents < expected then
                        Denied(
                            "PAYMENT_AMOUNT_TAMPERED",
                            402,
                            sprintf "Monto recibido (%d¢) inferior al precio oficial inmutable (%d¢)." reportedAmountCents expected
                        )
                    else
                        Allowed(sprintf "VERIFIED_%s_%d" spec.SkuCode expected)

    /// Enforces immutable seat limits and prevents non-Owners from inviting Admins.
    let validateSeatInvite (skuCode: string) (actorRoleStr: string) (targetRoleStr: string) (currentSeats: int) : GuardVerdict =
        match parsePlanSku skuCode, parseOrgRole actorRoleStr, parseOrgRole targetRoleStr with
        | None, _, _ -> Denied("UNKNOWN_SKU", 402, "Se requiere un plan Credo One activo.")
        | _, None, _ -> Denied("INVALID_ACTOR_ROLE", 403, "Rol de actor no válido.")
        | _, _, None -> Denied("INVALID_TARGET_ROLE", 400, "Rol de invitación no válido.")
        | _, _, Some Owner -> Denied("CANNOT_INVITE_OWNER", 400, "No se puede invitar otro Owner principal.")
        | _, Some actorRole, Some targetRole when targetRole = Admin && actorRole <> Owner ->
            Denied("OWNER_ONLY_ADMIN_GRANT", 403, "Solo el Owner puede asignar el rol Admin.")
        | Some sku, Some actorRole, Some _ ->
            if not ((rolePermissions actorRole).Contains("team:manage_members")) then
                Denied("RBAC_FORBIDDEN", 403, "No tienes permiso para invitar miembros.")
            else
                match tryGetPlan sku with
                | None -> Denied("UNKNOWN_SKU", 402, "Plan no encontrado.")
                | Some spec ->
                    if spec.MaxSeats > 0 && currentSeats >= spec.MaxSeats then
                        Denied(
                            "SEAT_LIMIT_REACHED",
                            402,
                            sprintf "Alcanzaste el límite de %d asientos de tu plan (%s)." spec.MaxSeats spec.DisplayName
                        )
                    else
                        Allowed("SEAT_AVAILABLE")

    /// Validates campaign creation: CTA tier gate, active campaign cap, clamped impression budget,
    /// and mandatory Enterprise / Pro approval workflow routing.
    type CampaignValidationResult =
        { Allowed: bool
          Code: string
          HttpStatus: int
          Message: string
          SafeAllocatedImpressions: int
          RequiresApproval: bool }

    let validateCampaignCreation
        (skuCode: string)
        (actorRoleStr: string)
        (ctaTypeStr: string)
        (activeCampaignsCount: int)
        (requestedImpressions: int)
        (remainingPool: int)
        (orgApprovalRequired: bool)
        : CampaignValidationResult =
        match parsePlanSku skuCode, parseOrgRole actorRoleStr, parseCtaType ctaTypeStr with
        | None, _, _ ->
            { Allowed = false; Code = "PLAN_REQUIRED"; HttpStatus = 402
              Message = "Necesitas un plan Credo One activo."; SafeAllocatedImpressions = 0; RequiresApproval = false }
        | _, None, _ ->
            { Allowed = false; Code = "INVALID_ROLE"; HttpStatus = 403
              Message = "Rol inválido."; SafeAllocatedImpressions = 0; RequiresApproval = false }
        | _, _, None ->
            { Allowed = false; Code = "INVALID_CTA"; HttpStatus = 400
              Message = "Tipo de botón CTA no válido."; SafeAllocatedImpressions = 0; RequiresApproval = false }
        | Some sku, Some role, Some cta ->
            if not ((rolePermissions role).Contains("campaign:draft")) then
                { Allowed = false; Code = "RBAC_FORBIDDEN"; HttpStatus = 403
                  Message = "Tu rol no permite crear campañas."; SafeAllocatedImpressions = 0; RequiresApproval = false }
            else
                match tryGetPlan sku with
                | None ->
                    { Allowed = false; Code = "PLAN_REQUIRED"; HttpStatus = 402
                      Message = "Plan inválido."; SafeAllocatedImpressions = 0; RequiresApproval = false }
                | Some spec ->
                    if not spec.StudioAccess then
                        { Allowed = false; Code = "STUDIO_LOCKED"; HttpStatus = 403
                          Message = "Tu plan actual no incluye Credo One Studio."; SafeAllocatedImpressions = 0; RequiresApproval = false }
                    elif cta = LeadForm && not spec.IsEnterprise then
                        { Allowed = false; Code = "ENTERPRISE_REQUIRED"; HttpStatus = 403
                          Message = "Los Formularios de Leads Nativos in-app son exclusivos de Credo One Enterprise."
                          SafeAllocatedImpressions = 0; RequiresApproval = false }
                    elif (cta = Offering || cta = EventRegister) && (spec.Sku = UserOnePro || spec.Sku = BizOnePlus) then
                        { Allowed = false; Code = "UPGRADE_REQUIRED"; HttpStatus = 403
                          Message = "Los botones avanzados de conversión requieren Empresas One Pro o Enterprise."
                          SafeAllocatedImpressions = 0; RequiresApproval = false }
                    elif spec.MaxActiveCampaigns > 0 && activeCampaignsCount >= spec.MaxActiveCampaigns then
                        { Allowed = false; Code = "CAMPAIGN_LIMIT_REACHED"; HttpStatus = 402
                          Message = sprintf "Tu plan (%s) permite hasta %d campañas activas simultáneas." spec.DisplayName spec.MaxActiveCampaigns
                          SafeAllocatedImpressions = 0; RequiresApproval = false }
                    else
                        let maxCap =
                            if remainingPool > 0 then min spec.MonthlyImpressions remainingPool
                            else spec.MonthlyImpressions
                        let clamped =
                            requestedImpressions
                            |> max MinCampaignAllocation
                            |> min (max MinCampaignAllocation maxCap)
                        let needsApproval = role = Editor && (spec.IsEnterprise || orgApprovalRequired)
                        { Allowed = true
                          Code = "CAMPAIGN_OK"
                          HttpStatus = 200
                          Message = "Validado por el núcleo F#."
                          SafeAllocatedImpressions = clamped
                          RequiresApproval = needsApproval }
