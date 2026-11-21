import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_en.dart';
import 'app_localizations_es.dart';
import 'app_localizations_fr.dart';
import 'app_localizations_it.dart';
import 'app_localizations_pt.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'generated/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
    : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
        delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('en'),
    Locale('es'),
    Locale('fr'),
    Locale('it'),
    Locale('pt'),
  ];

  /// No description provided for @appTitle.
  ///
  /// In es, this message translates to:
  /// **'Credo'**
  String get appTitle;

  /// No description provided for @appSubtitle.
  ///
  /// In es, this message translates to:
  /// **'Red Eclesiástica Internacional'**
  String get appSubtitle;

  /// No description provided for @navFeed.
  ///
  /// In es, this message translates to:
  /// **'Comunión'**
  String get navFeed;

  /// No description provided for @navHierarchy.
  ///
  /// In es, this message translates to:
  /// **'Jerarquía'**
  String get navHierarchy;

  /// No description provided for @navDirectory.
  ///
  /// In es, this message translates to:
  /// **'Directorio'**
  String get navDirectory;

  /// No description provided for @navMessages.
  ///
  /// In es, this message translates to:
  /// **'Mensajes'**
  String get navMessages;

  /// No description provided for @navProfile.
  ///
  /// In es, this message translates to:
  /// **'Perfil'**
  String get navProfile;

  /// No description provided for @signIn.
  ///
  /// In es, this message translates to:
  /// **'Iniciar sesión'**
  String get signIn;

  /// No description provided for @register.
  ///
  /// In es, this message translates to:
  /// **'Crear cuenta'**
  String get register;

  /// No description provided for @signOut.
  ///
  /// In es, this message translates to:
  /// **'Cerrar sesión'**
  String get signOut;

  /// No description provided for @emailOrUsername.
  ///
  /// In es, this message translates to:
  /// **'Correo o usuario'**
  String get emailOrUsername;

  /// No description provided for @email.
  ///
  /// In es, this message translates to:
  /// **'Correo electrónico'**
  String get email;

  /// No description provided for @username.
  ///
  /// In es, this message translates to:
  /// **'Nombre de usuario'**
  String get username;

  /// No description provided for @password.
  ///
  /// In es, this message translates to:
  /// **'Contraseña'**
  String get password;

  /// No description provided for @fullName.
  ///
  /// In es, this message translates to:
  /// **'Nombre completo'**
  String get fullName;

  /// No description provided for @titlePrefix.
  ///
  /// In es, this message translates to:
  /// **'Tratamiento (P., Mons., Card.)'**
  String get titlePrefix;

  /// No description provided for @selectRank.
  ///
  /// In es, this message translates to:
  /// **'Estado / Rango eclesiástico'**
  String get selectRank;

  /// No description provided for @selectAffiliation.
  ///
  /// In es, this message translates to:
  /// **'Institución a la que pertenece (Parroquia, Diócesis, Orden...)'**
  String get selectAffiliation;

  /// No description provided for @optionalReligiousOrder.
  ///
  /// In es, this message translates to:
  /// **'Orden o Congregación Religiosa (opcional)'**
  String get optionalReligiousOrder;

  /// No description provided for @currentOfficeTitle.
  ///
  /// In es, this message translates to:
  /// **'Cargo o servicio actual (ej. Párroco, Obispo, Coro)'**
  String get currentOfficeTitle;

  /// No description provided for @bio.
  ///
  /// In es, this message translates to:
  /// **'Biografía pastoral'**
  String get bio;

  /// No description provided for @motto.
  ///
  /// In es, this message translates to:
  /// **'Lema episcopal / sacerdotal / espiritual'**
  String get motto;

  /// No description provided for @country.
  ///
  /// In es, this message translates to:
  /// **'País'**
  String get country;

  /// No description provided for @createAccount.
  ///
  /// In es, this message translates to:
  /// **'Unirse a Credo'**
  String get createAccount;

  /// No description provided for @alreadyHaveAccount.
  ///
  /// In es, this message translates to:
  /// **'¿Ya tienes cuenta? Inicia sesión'**
  String get alreadyHaveAccount;

  /// No description provided for @noAccountYet.
  ///
  /// In es, this message translates to:
  /// **'¿Nuevo en Credo? Regístrate aquí'**
  String get noAccountYet;

  /// No description provided for @demoQuickAccess.
  ///
  /// In es, this message translates to:
  /// **'Acceso rápido de demostración'**
  String get demoQuickAccess;

  /// No description provided for @demoClergyAccount.
  ///
  /// In es, this message translates to:
  /// **'Entrar como Clero (P. Mateo · Puede publicar)'**
  String get demoClergyAccount;

  /// No description provided for @demoLayAccount.
  ///
  /// In es, this message translates to:
  /// **'Entrar como Laico (María · Solo lectura/interacción)'**
  String get demoLayAccount;

  /// No description provided for @clergyCanPublishHint.
  ///
  /// In es, this message translates to:
  /// **'Como miembro del clero puedes publicar homilías, cartas pastorales, decretos y anuncios.'**
  String get clergyCanPublishHint;

  /// No description provided for @layCannotPublishHint.
  ///
  /// In es, this message translates to:
  /// **'Todos tienen perfil completo, siguen la jerarquía, reaccionan, comentan y chatean; solo el clero puede crear publicaciones.'**
  String get layCannotPublishHint;

  /// No description provided for @welcomeBack.
  ///
  /// In es, this message translates to:
  /// **'Paz y bien'**
  String get welcomeBack;

  /// No description provided for @joinCredo.
  ///
  /// In es, this message translates to:
  /// **'Únete a la red eclesiástica mundial'**
  String get joinCredo;

  /// No description provided for @scopeGlobal.
  ///
  /// In es, this message translates to:
  /// **'Universal'**
  String get scopeGlobal;

  /// No description provided for @scopeFollowing.
  ///
  /// In es, this message translates to:
  /// **'Siguiendo'**
  String get scopeFollowing;

  /// No description provided for @scopeMyCountry.
  ///
  /// In es, this message translates to:
  /// **'Mi País'**
  String get scopeMyCountry;

  /// No description provided for @scopeMyArchdiocese.
  ///
  /// In es, this message translates to:
  /// **'Mi Arquidiócesis'**
  String get scopeMyArchdiocese;

  /// No description provided for @scopeMyDiocese.
  ///
  /// In es, this message translates to:
  /// **'Mi Diócesis'**
  String get scopeMyDiocese;

  /// No description provided for @scopeMyParish.
  ///
  /// In es, this message translates to:
  /// **'Mi Parroquia'**
  String get scopeMyParish;

  /// No description provided for @newPublication.
  ///
  /// In es, this message translates to:
  /// **'Nueva publicación'**
  String get newPublication;

  /// No description provided for @publish.
  ///
  /// In es, this message translates to:
  /// **'Publicar'**
  String get publish;

  /// No description provided for @clergyOnlyPublishTitle.
  ///
  /// In es, this message translates to:
  /// **'Publicación exclusiva del clero'**
  String get clergyOnlyPublishTitle;

  /// No description provided for @clergyOnlyPublishDesc.
  ///
  /// In es, this message translates to:
  /// **'En Credo todos pueden tener perfil, reaccionar, comentar y participar en grupos pastorales, pero las publicaciones del muro están reservadas al clero ordenado.'**
  String get clergyOnlyPublishDesc;

  /// No description provided for @postTitle.
  ///
  /// In es, this message translates to:
  /// **'Título (opcional)'**
  String get postTitle;

  /// No description provided for @postContent.
  ///
  /// In es, this message translates to:
  /// **'Escribe tu homilía, anuncio o reflexión pastoral...'**
  String get postContent;

  /// No description provided for @scriptureRef.
  ///
  /// In es, this message translates to:
  /// **'Cita bíblica o magisterial (ej. Jn 17, 21)'**
  String get scriptureRef;

  /// No description provided for @eventLocation.
  ///
  /// In es, this message translates to:
  /// **'Lugar del evento (opcional)'**
  String get eventLocation;

  /// No description provided for @postType.
  ///
  /// In es, this message translates to:
  /// **'Tipo de publicación'**
  String get postType;

  /// No description provided for @targetScope.
  ///
  /// In es, this message translates to:
  /// **'Alcance jerárquico'**
  String get targetScope;

  /// No description provided for @noPostsYet.
  ///
  /// In es, this message translates to:
  /// **'Aún no hay publicaciones en este alcance.'**
  String get noPostsYet;

  /// No description provided for @amen.
  ///
  /// In es, this message translates to:
  /// **'Amén'**
  String get amen;

  /// No description provided for @pray.
  ///
  /// In es, this message translates to:
  /// **'En oración'**
  String get pray;

  /// No description provided for @gratitude.
  ///
  /// In es, this message translates to:
  /// **'Gracias'**
  String get gratitude;

  /// No description provided for @comments.
  ///
  /// In es, this message translates to:
  /// **'Comentarios'**
  String get comments;

  /// No description provided for @writeComment.
  ///
  /// In es, this message translates to:
  /// **'Escribe un comentario respetuoso...'**
  String get writeComment;

  /// No description provided for @send.
  ///
  /// In es, this message translates to:
  /// **'Enviar'**
  String get send;

  /// No description provided for @pinned.
  ///
  /// In es, this message translates to:
  /// **'Destacado'**
  String get pinned;

  /// No description provided for @deletePost.
  ///
  /// In es, this message translates to:
  /// **'Eliminar'**
  String get deletePost;

  /// No description provided for @postTypeHomily.
  ///
  /// In es, this message translates to:
  /// **'Homilía'**
  String get postTypeHomily;

  /// No description provided for @postTypePastoralLetter.
  ///
  /// In es, this message translates to:
  /// **'Carta Pastoral'**
  String get postTypePastoralLetter;

  /// No description provided for @postTypeAnnouncement.
  ///
  /// In es, this message translates to:
  /// **'Comunicado'**
  String get postTypeAnnouncement;

  /// No description provided for @postTypeDecree.
  ///
  /// In es, this message translates to:
  /// **'Decreto'**
  String get postTypeDecree;

  /// No description provided for @postTypeReflection.
  ///
  /// In es, this message translates to:
  /// **'Reflexión'**
  String get postTypeReflection;

  /// No description provided for @postTypeEvent.
  ///
  /// In es, this message translates to:
  /// **'Evento Litúrgico'**
  String get postTypeEvent;

  /// No description provided for @rankPope.
  ///
  /// In es, this message translates to:
  /// **'Sumo Pontífice'**
  String get rankPope;

  /// No description provided for @rankCardinal.
  ///
  /// In es, this message translates to:
  /// **'Cardenal'**
  String get rankCardinal;

  /// No description provided for @rankArchbishop.
  ///
  /// In es, this message translates to:
  /// **'Arzobispo'**
  String get rankArchbishop;

  /// No description provided for @rankBishop.
  ///
  /// In es, this message translates to:
  /// **'Obispo'**
  String get rankBishop;

  /// No description provided for @rankMonsignor.
  ///
  /// In es, this message translates to:
  /// **'Monseñor'**
  String get rankMonsignor;

  /// No description provided for @rankPriest.
  ///
  /// In es, this message translates to:
  /// **'Sacerdote'**
  String get rankPriest;

  /// No description provided for @rankDeacon.
  ///
  /// In es, this message translates to:
  /// **'Diácono'**
  String get rankDeacon;

  /// No description provided for @rankReligious.
  ///
  /// In es, this message translates to:
  /// **'Vida Consagrada'**
  String get rankReligious;

  /// No description provided for @rankSeminarian.
  ///
  /// In es, this message translates to:
  /// **'Seminarista'**
  String get rankSeminarian;

  /// No description provided for @rankCatechist.
  ///
  /// In es, this message translates to:
  /// **'Catequista / Ministro'**
  String get rankCatechist;

  /// No description provided for @rankLay.
  ///
  /// In es, this message translates to:
  /// **'Fiel Laico'**
  String get rankLay;

  /// No description provided for @clergyBadge.
  ///
  /// In es, this message translates to:
  /// **'Clero'**
  String get clergyBadge;

  /// No description provided for @verifiedClergy.
  ///
  /// In es, this message translates to:
  /// **'Clero verificado'**
  String get verifiedClergy;

  /// No description provided for @pendingVerification.
  ///
  /// In es, this message translates to:
  /// **'Verificación pendiente'**
  String get pendingVerification;

  /// No description provided for @faithfulBadge.
  ///
  /// In es, this message translates to:
  /// **'Fiel'**
  String get faithfulBadge;

  /// No description provided for @unitHolySee.
  ///
  /// In es, this message translates to:
  /// **'Santa Sede'**
  String get unitHolySee;

  /// No description provided for @unitDicastery.
  ///
  /// In es, this message translates to:
  /// **'Dicasterio'**
  String get unitDicastery;

  /// No description provided for @unitEpiscopalConference.
  ///
  /// In es, this message translates to:
  /// **'Conferencia Episcopal'**
  String get unitEpiscopalConference;

  /// No description provided for @unitArchdiocese.
  ///
  /// In es, this message translates to:
  /// **'Arquidiócesis'**
  String get unitArchdiocese;

  /// No description provided for @unitDiocese.
  ///
  /// In es, this message translates to:
  /// **'Diócesis'**
  String get unitDiocese;

  /// No description provided for @unitVicariate.
  ///
  /// In es, this message translates to:
  /// **'Vicaría / Decanato'**
  String get unitVicariate;

  /// No description provided for @unitParish.
  ///
  /// In es, this message translates to:
  /// **'Parroquia / Templo'**
  String get unitParish;

  /// No description provided for @unitReligiousOrder.
  ///
  /// In es, this message translates to:
  /// **'Orden Religiosa'**
  String get unitReligiousOrder;

  /// No description provided for @unitSeminary.
  ///
  /// In es, this message translates to:
  /// **'Seminario / Universidad'**
  String get unitSeminary;

  /// No description provided for @worldwideHierarchy.
  ///
  /// In es, this message translates to:
  /// **'Jerarquía Eclesiástica Mundial'**
  String get worldwideHierarchy;

  /// No description provided for @exploreHierarchySubtitle.
  ///
  /// In es, this message translates to:
  /// **'Navega desde la Santa Sede hasta cada Conferencia Episcopal, Arquidiócesis, Diócesis, Parroquia y Orden Religiosa.'**
  String get exploreHierarchySubtitle;

  /// No description provided for @searchHierarchy.
  ///
  /// In es, this message translates to:
  /// **'Buscar diócesis, parroquia, país u orden...'**
  String get searchHierarchy;

  /// No description provided for @subordinateUnits.
  ///
  /// In es, this message translates to:
  /// **'Jurisdicciones e instituciones dependientes'**
  String get subordinateUnits;

  /// No description provided for @affiliatedMembers.
  ///
  /// In es, this message translates to:
  /// **'Clero y fieles adscritos'**
  String get affiliatedMembers;

  /// No description provided for @belongsToLineage.
  ///
  /// In es, this message translates to:
  /// **'Pertenece a'**
  String get belongsToLineage;

  /// No description provided for @openPastoralGroup.
  ///
  /// In es, this message translates to:
  /// **'Abrir grupo pastoral'**
  String get openPastoralGroup;

  /// No description provided for @addEcclesiasticalUnit.
  ///
  /// In es, this message translates to:
  /// **'Registrar nueva institución'**
  String get addEcclesiasticalUnit;

  /// No description provided for @unitName.
  ///
  /// In es, this message translates to:
  /// **'Nombre oficial'**
  String get unitName;

  /// No description provided for @latinName.
  ///
  /// In es, this message translates to:
  /// **'Nombre en latín (opcional)'**
  String get latinName;

  /// No description provided for @unitType.
  ///
  /// In es, this message translates to:
  /// **'Tipo de institución'**
  String get unitType;

  /// No description provided for @parentUnit.
  ///
  /// In es, this message translates to:
  /// **'Jurisdicción superior'**
  String get parentUnit;

  /// No description provided for @city.
  ///
  /// In es, this message translates to:
  /// **'Ciudad'**
  String get city;

  /// No description provided for @patronSaint.
  ///
  /// In es, this message translates to:
  /// **'Santo Patrono'**
  String get patronSaint;

  /// No description provided for @foundedYear.
  ///
  /// In es, this message translates to:
  /// **'Año de erección'**
  String get foundedYear;

  /// No description provided for @description.
  ///
  /// In es, this message translates to:
  /// **'Descripción'**
  String get description;

  /// No description provided for @save.
  ///
  /// In es, this message translates to:
  /// **'Guardar'**
  String get save;

  /// No description provided for @cancel.
  ///
  /// In es, this message translates to:
  /// **'Cancelar'**
  String get cancel;

  /// No description provided for @follow.
  ///
  /// In es, this message translates to:
  /// **'Seguir'**
  String get follow;

  /// No description provided for @following.
  ///
  /// In es, this message translates to:
  /// **'Siguiendo'**
  String get following;

  /// No description provided for @followers.
  ///
  /// In es, this message translates to:
  /// **'Seguidores'**
  String get followers;

  /// No description provided for @posts.
  ///
  /// In es, this message translates to:
  /// **'Publicaciones'**
  String get posts;

  /// No description provided for @unitsCount.
  ///
  /// In es, this message translates to:
  /// **'Jurisdicciones'**
  String get unitsCount;

  /// No description provided for @countriesCount.
  ///
  /// In es, this message translates to:
  /// **'Países'**
  String get countriesCount;

  /// No description provided for @clergyCount.
  ///
  /// In es, this message translates to:
  /// **'Clero'**
  String get clergyCount;

  /// No description provided for @directoryTitle.
  ///
  /// In es, this message translates to:
  /// **'Directorio Internacional'**
  String get directoryTitle;

  /// No description provided for @searchDirectoryHint.
  ///
  /// In es, this message translates to:
  /// **'Buscar sacerdotes, obispos, cardenales, diócesis...'**
  String get searchDirectoryHint;

  /// No description provided for @tabPeople.
  ///
  /// In es, this message translates to:
  /// **'Clero y Fieles'**
  String get tabPeople;

  /// No description provided for @tabInstitutions.
  ///
  /// In es, this message translates to:
  /// **'Instituciones'**
  String get tabInstitutions;

  /// No description provided for @filterAllRanks.
  ///
  /// In es, this message translates to:
  /// **'Todos los rangos'**
  String get filterAllRanks;

  /// No description provided for @filterClergyOnly.
  ///
  /// In es, this message translates to:
  /// **'Solo clero'**
  String get filterClergyOnly;

  /// No description provided for @filterVerifiedOnly.
  ///
  /// In es, this message translates to:
  /// **'Verificados'**
  String get filterVerifiedOnly;

  /// No description provided for @noResults.
  ///
  /// In es, this message translates to:
  /// **'No se encontraron resultados.'**
  String get noResults;

  /// No description provided for @editProfile.
  ///
  /// In es, this message translates to:
  /// **'Editar perfil'**
  String get editProfile;

  /// No description provided for @assignmentHistory.
  ///
  /// In es, this message translates to:
  /// **'Historial de cargos y adscripciones'**
  String get assignmentHistory;

  /// No description provided for @addAssignment.
  ///
  /// In es, this message translates to:
  /// **'Añadir cargo'**
  String get addAssignment;

  /// No description provided for @roleTitle.
  ///
  /// In es, this message translates to:
  /// **'Cargo desempeñado'**
  String get roleTitle;

  /// No description provided for @startYear.
  ///
  /// In es, this message translates to:
  /// **'Año inicio'**
  String get startYear;

  /// No description provided for @endYear.
  ///
  /// In es, this message translates to:
  /// **'Año fin (vacío = actual)'**
  String get endYear;

  /// No description provided for @currentAssignment.
  ///
  /// In es, this message translates to:
  /// **'Cargo actual'**
  String get currentAssignment;

  /// No description provided for @primaryAffiliation.
  ///
  /// In es, this message translates to:
  /// **'Adscripción principal'**
  String get primaryAffiliation;

  /// No description provided for @religiousOrder.
  ///
  /// In es, this message translates to:
  /// **'Orden / Congregación'**
  String get religiousOrder;

  /// No description provided for @ordinationDate.
  ///
  /// In es, this message translates to:
  /// **'Fecha de ordenación'**
  String get ordinationDate;

  /// No description provided for @sendMessage.
  ///
  /// In es, this message translates to:
  /// **'Enviar mensaje'**
  String get sendMessage;

  /// No description provided for @verifyClergy.
  ///
  /// In es, this message translates to:
  /// **'Verificar clero'**
  String get verifyClergy;

  /// No description provided for @requestVerification.
  ///
  /// In es, this message translates to:
  /// **'Solicitar verificación'**
  String get requestVerification;

  /// No description provided for @myPublications.
  ///
  /// In es, this message translates to:
  /// **'Publicaciones'**
  String get myPublications;

  /// No description provided for @noAssignmentsYet.
  ///
  /// In es, this message translates to:
  /// **'Sin historial registrado aún.'**
  String get noAssignmentsYet;

  /// No description provided for @language.
  ///
  /// In es, this message translates to:
  /// **'Idioma'**
  String get language;

  /// No description provided for @messagesTitle.
  ///
  /// In es, this message translates to:
  /// **'Mensajería y Grupos Pastorales'**
  String get messagesTitle;

  /// No description provided for @myChats.
  ///
  /// In es, this message translates to:
  /// **'Mis conversaciones'**
  String get myChats;

  /// No description provided for @discoverGroups.
  ///
  /// In es, this message translates to:
  /// **'Descubrir grupos'**
  String get discoverGroups;

  /// No description provided for @newPastoralGroup.
  ///
  /// In es, this message translates to:
  /// **'Nuevo grupo pastoral'**
  String get newPastoralGroup;

  /// No description provided for @groupTitle.
  ///
  /// In es, this message translates to:
  /// **'Nombre del grupo'**
  String get groupTitle;

  /// No description provided for @groupDescription.
  ///
  /// In es, this message translates to:
  /// **'Propósito pastoral'**
  String get groupDescription;

  /// No description provided for @joinGroup.
  ///
  /// In es, this message translates to:
  /// **'Unirse'**
  String get joinGroup;

  /// No description provided for @joined.
  ///
  /// In es, this message translates to:
  /// **'Miembro'**
  String get joined;

  /// No description provided for @typeMessage.
  ///
  /// In es, this message translates to:
  /// **'Escribe un mensaje...'**
  String get typeMessage;

  /// No description provided for @noConversationsYet.
  ///
  /// In es, this message translates to:
  /// **'Aún no tienes conversaciones. Explora grupos pastorales o escribe desde un perfil.'**
  String get noConversationsYet;

  /// No description provided for @directMessage.
  ///
  /// In es, this message translates to:
  /// **'Mensaje directo'**
  String get directMessage;

  /// No description provided for @pastoralGroup.
  ///
  /// In es, this message translates to:
  /// **'Grupo pastoral'**
  String get pastoralGroup;

  /// No description provided for @members.
  ///
  /// In es, this message translates to:
  /// **'miembros'**
  String get members;

  /// No description provided for @present.
  ///
  /// In es, this message translates to:
  /// **'Presente'**
  String get present;

  /// No description provided for @signInRequired.
  ///
  /// In es, this message translates to:
  /// **'Inicia sesión para participar'**
  String get signInRequired;
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['en', 'es', 'fr', 'it', 'pt'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'en':
      return AppLocalizationsEn();
    case 'es':
      return AppLocalizationsEs();
    case 'fr':
      return AppLocalizationsFr();
    case 'it':
      return AppLocalizationsIt();
    case 'pt':
      return AppLocalizationsPt();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
