namespace CredoOne.Core

/// Immutable strongly-typed domain model for critical Credo One pricing,
/// quota ceilings, RBAC roles, CTA tier gates, and security decisions.
module Domain =

    [<Struct>]
    type UsdCents = UsdCents of int

    type Audience =
        | User
        | Business

    type BillingCycle =
        | Monthly
        | Annual
        | Custom

    type PlanSku =
        | UserOnePlus
        | UserOnePro
        | BizOnePlus
        | BizOnePro
        | BizOneEnterprise

    type OrgRole =
        | Owner
        | Admin
        | Editor
        | Moderator
        | Analyst

    type CtaType =
        | WhatsApp
        | Web
        | Offering
        | EventRegister
        | LeadForm

    type BadgeType =
        | NoBadge
        | OnePlus
        | VerifiedPersonal
        | VerifiedBusiness
        | EnterpriseGold

    type PlanSpec =
        { Sku: PlanSku
          SkuCode: string
          Audience: Audience
          AudienceCode: string
          DisplayName: string
          Subtitle: string
          PriceMonthlyCents: int
          PriceAnnualCents: int
          IsPopular: bool
          IsEnterprise: bool
          MaxSeats: int            // -1 = unlimited
          MonthlyImpressions: int
          MaxActiveCampaigns: int  // -1 = unlimited
          AdFree: bool
          CanPublishOpen: bool
          StudioAccess: bool
          ApprovalWorkflow: bool
          AuditLogsEnabled: bool
          BadgeType: BadgeType
          BadgeCode: string
          SortOrder: int
          Features: string list }

    type GuardVerdict =
        | Allowed of reason: string
        | Denied of code: string * httpStatus: int * message: string

    let parsePlanSku (raw: string) : PlanSku option =
        match (if isNull raw then "" else raw.Trim().ToLowerInvariant()) with
        | "user_one_plus" -> Some UserOnePlus
        | "user_one_pro" -> Some UserOnePro
        | "biz_one_plus" -> Some BizOnePlus
        | "biz_one_pro" -> Some BizOnePro
        | "biz_one_enterprise" -> Some BizOneEnterprise
        | _ -> None

    let parseBillingCycle (raw: string) : BillingCycle option =
        match (if isNull raw then "" else raw.Trim().ToLowerInvariant()) with
        | "monthly" -> Some Monthly
        | "annual" -> Some Annual
        | "custom" -> Some Custom
        | _ -> None

    let parseOrgRole (raw: string) : OrgRole option =
        match (if isNull raw then "" else raw.Trim().ToLowerInvariant()) with
        | "owner" -> Some Owner
        | "admin" -> Some Admin
        | "editor" -> Some Editor
        | "moderator" -> Some Moderator
        | "analyst" -> Some Analyst
        | _ -> None

    let parseCtaType (raw: string) : CtaType option =
        match (if isNull raw then "" else raw.Trim().ToLowerInvariant()) with
        | "whatsapp" -> Some WhatsApp
        | "web" -> Some Web
        | "offering" -> Some Offering
        | "event_register" -> Some EventRegister
        | "lead_form" -> Some LeadForm
        | _ -> None
