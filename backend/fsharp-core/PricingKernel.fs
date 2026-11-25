namespace CredoOne.Core

open System
open System.Security.Cryptography
open System.Text
open CredoOne.Core.Domain

/// Single Immutable Source of Truth for ALL Credo One pricing (in integer USD cents),
/// seat ceilings, monthly impression pools, campaign caps, and entitlement flags.
/// Compiled into native F# code so runtime JS/client payloads can never alter core numbers.
module PricingKernel =

    [<Literal>]
    let MinCampaignAllocation = 500

    [<Literal>]
    let AnnualFreeMonths = 2

    [<Literal>]
    let FeedInjectionFirstSlotIndex = 1

    [<Literal>]
    let FeedInjectionIntervalPosts = 6

    [<Literal>]
    let MaxSponsoredCardsPerPage = 3

    let private plansList : PlanSpec list =
        [ { Sku = UserOnePlus
            SkuCode = "user_one_plus"
            Audience = User
            AudienceCode = "user"
            DisplayName = "Credo One Plus"
            Subtitle = "Para miembros que desean apoyar la plataforma y mejorar su experiencia diaria."
            PriceMonthlyCents = 300
            PriceAnnualCents = 3000
            IsPopular = false
            IsEnterprise = false
            MaxSeats = 1
            MonthlyImpressions = 0
            MaxActiveCampaigns = 0
            AdFree = true
            CanPublishOpen = false
            StudioAccess = false
            ApprovalWorkflow = false
            AuditLogsEnabled = false
            BadgeType = OnePlus
            BadgeCode = "one_plus"
            SortOrder = 10
            Features =
              [ "Experiencia 100% libre de anuncios comerciales"
                "Reproducción continua de audio y emisoras en segundo plano"
                "Guardados y colecciones ilimitadas de oraciones y evangelios"
                "Insignia personal \"One Plus\" junto a tu nombre"
                "Soporte prioritario para miembros" ] }

          { Sku = UserOnePro
            SkuCode = "user_one_pro"
            Audience = User
            AudienceCode = "user"
            DisplayName = "Credo One Pro"
            Subtitle = "Para creadores individuales, músicos, predicadores, profesionales y líderes de opinión."
            PriceMonthlyCents = 900
            PriceAnnualCents = 9000
            IsPopular = true
            IsEnterprise = false
            MaxSeats = 1
            MonthlyImpressions = 5000
            MaxActiveCampaigns = 1
            AdFree = true
            CanPublishOpen = true
            StudioAccess = true
            ApprovalWorkflow = false
            AuditLogsEnabled = false
            BadgeType = VerifiedPersonal
            BadgeCode = "verified_personal"
            SortOrder = 20
            Features =
              [ "Todo lo incluido en User One Plus"
                "Insignia Verificada Personal"
                "Publicación multimedia de alcance abierto"
                "1 enlace externo directo en tu biografía"
                "Programador de publicaciones"
                "Acceso a Credo One Studio (estadísticas + 1 campaña activa con 5,000 impresiones/mes)" ] }

          { Sku = BizOnePlus
            SkuCode = "biz_one_plus"
            Audience = Business
            AudienceCode = "business"
            DisplayName = "Credo One Plus"
            Subtitle = "Para pequeños comercios, ministerios musicales, proyectos locales y emprendimientos."
            PriceMonthlyCents = 2500
            PriceAnnualCents = 25000
            IsPopular = false
            IsEnterprise = false
            MaxSeats = 2
            MonthlyImpressions = 20000
            MaxActiveCampaigns = 3
            AdFree = false
            CanPublishOpen = true
            StudioAccess = true
            ApprovalWorkflow = false
            AuditLogsEnabled = false
            BadgeType = VerifiedBusiness
            BadgeCode = "verified_business"
            SortOrder = 30
            Features =
              [ "Insignia Comercial Verificada"
                "Permiso oficial de publicación comercial e institucional"
                "Botones de acción en publicaciones (\"Ir a WhatsApp\" o \"Visitar Web\")"
                "2 asientos de equipo (Owner + Editor)"
                "Credo One Studio con hasta 3 campañas activas simultáneas"
                "Bolsa garantizada de 20,000 impresiones mensuales en el feed" ] }

          { Sku = BizOnePro
            SkuCode = "biz_one_pro"
            Audience = Business
            AudienceCode = "business"
            DisplayName = "Credo One Pro"
            Subtitle = "Para parroquias, emisoras de radio/TV, colegios, fundaciones y pymes en crecimiento."
            PriceMonthlyCents = 5900
            PriceAnnualCents = 59000
            IsPopular = true
            IsEnterprise = false
            MaxSeats = 5
            MonthlyImpressions = 75000
            MaxActiveCampaigns = -1
            AdFree = false
            CanPublishOpen = true
            StudioAccess = true
            ApprovalWorkflow = true
            AuditLogsEnabled = false
            BadgeType = VerifiedBusiness
            BadgeCode = "verified_business"
            SortOrder = 40
            Features =
              [ "Todo lo incluido en Empresas One Plus"
                "Posición prioritaria en la barra superior de transmisiones \"En Vivo\""
                "Cartelera fija de horarios y eventos en el perfil"
                "Botones avanzados (\"WhatsApp\", \"Web\", \"Ofrenda Digital\", \"Registro a Evento\")"
                "5 asientos de administración multinivel (Owner, Admin, Editor, Moderator, Analyst)"
                "Campañas ilimitadas con segmentación geográfica (país/ciudad) y destaque en Explorar"
                "Bolsa garantizada de 75,000 impresiones mensuales + exportación CSV/PDF" ] }

          { Sku = BizOneEnterprise
            SkuCode = "biz_one_enterprise"
            Audience = Business
            AudienceCode = "business"
            DisplayName = "Credo One Enterprise"
            Subtitle = "Para bancos, universidades, clínicas, aseguradoras, diócesis y grandes marcas nacionales."
            PriceMonthlyCents = 35000
            PriceAnnualCents = 350000
            IsPopular = false
            IsEnterprise = true
            MaxSeats = -1
            MonthlyImpressions = 350000
            MaxActiveCampaigns = -1
            AdFree = false
            CanPublishOpen = true
            StudioAccess = true
            ApprovalWorkflow = true
            AuditLogsEnabled = true
            BadgeType = EnterpriseGold
            BadgeCode = "enterprise_gold"
            SortOrder = 50
            Features =
              [ "Insignia Dorada Corporativa + avatar institucional cuadrado"
                "Red de Subcuentas Afiliadas vinculadas con el mini-logo de la matriz"
                "Asientos ilimitados + flujo obligatorio de aprobación (Borrador → Revisión → Publicado)"
                "Registro de Auditoría completo e inmutable (Audit Logs)"
                "Centro de Comando Masivo con 350,000+ impresiones mensuales garantizadas"
                "Patrocinio nativo exclusivo (\"Evangelio / Oración del día presentado por [Marca]\")"
                "Banners fijos en Explorar, formularios nativos de leads in-app y reporte ejecutivo mensual PDF" ] } ]

    let allPlans () : PlanSpec list = plansList

    let tryGetPlan (sku: PlanSku) : PlanSpec option =
        plansList |> List.tryFind (fun p -> p.Sku = sku)

    let tryGetPlanByCode (skuCode: string) : PlanSpec option =
        parsePlanSku skuCode |> Option.bind tryGetPlan

    let expectedAmountCents (spec: PlanSpec) (cycle: BillingCycle) : int =
        match cycle with
        | Monthly -> spec.PriceMonthlyCents
        | Annual -> spec.PriceAnnualCents
        | Custom -> spec.PriceMonthlyCents

    /// Deterministic HMAC-SHA256 integrity seal across every immutable price, quota, and cap.
    let computeCatalogSeal (secret: string) : string =
        let keyBytes =
            Encoding.UTF8.GetBytes(
                if String.IsNullOrWhiteSpace(secret) then "credo-one-kernel-seal-v1" else secret
            )
        let canonical =
            plansList
            |> List.map (fun p ->
                sprintf "%s|%s|%d|%d|%d|%d|%d|%b|%b|%b|%b|%b"
                    p.SkuCode p.AudienceCode p.PriceMonthlyCents p.PriceAnnualCents
                    p.MaxSeats p.MonthlyImpressions p.MaxActiveCampaigns
                    p.AdFree p.CanPublishOpen p.StudioAccess p.ApprovalWorkflow p.AuditLogsEnabled)
            |> String.concat "\n"
        use hmac = new HMACSHA256(keyBytes)
        let hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(canonical))
        BitConverter.ToString(hash).Replace("-", "").ToLowerInvariant()
