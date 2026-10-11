import {
  Bell,
  ClipboardList,
  Factory,
  FileSignature,
  FileText,
  GraduationCap,
  LayoutDashboard,
  MapPin,
  PlusCircle,
  ScrollText,
  Settings,
  Shield,
  Tags,
  UserRound,
  Users,
  UsersRound,
  Wallet,
} from "lucide-react";
import { Home } from "lucide-react";
import type { MobileNavItem, NavItem } from "@/components/layout/dashboard-shell";

export const customerNav: NavItem[] = [
  { href: "/espace", label: "Tableau de bord", icon: LayoutDashboard, exact: true },
  { href: "/espace/commandes", label: "Mes commandes", icon: ClipboardList },
  { href: "/espace/commandes/nouvelle", label: "Nouvelle commande", icon: PlusCircle },
  { href: "/espace/documents", label: "Mes documents", icon: FileText },
  { href: "/espace/devis", label: "Devis & secrétariat", icon: FileSignature },
  { href: "/espace/groupes", label: "Mes collectes", icon: Users },
  { href: "/espace/delegue", label: "Espace délégué", icon: GraduationCap },
  { href: "/espace/notifications", label: "Notifications", icon: Bell },
  { href: "/espace/profil", label: "Profil", icon: UserRound },
  { href: "/admin", label: "Administration", icon: Shield, roles: ["ADMIN", "OPERATOR"] },
];

export const adminNav: NavItem[] = [
  { href: "/admin", label: "Tableau de bord", icon: LayoutDashboard, exact: true },
  { href: "/admin/production", label: "Production", icon: Factory },
  { href: "/admin/commandes", label: "Commandes", icon: ClipboardList },
  { href: "/admin/groupes", label: "Commandes groupées", icon: UsersRound },
  { href: "/admin/paiements", label: "Paiements", icon: Wallet, roles: ["ADMIN"] },
  { href: "/admin/devis", label: "Devis", icon: FileSignature, roles: ["ADMIN"] },
  { href: "/admin/utilisateurs", label: "Utilisateurs", icon: Users, roles: ["ADMIN"] },
  { href: "/admin/tarifs", label: "Tarifs", icon: Tags, roles: ["ADMIN"] },
  { href: "/admin/livraison", label: "Retrait & livraison", icon: MapPin, roles: ["ADMIN"] },
  { href: "/admin/parametres", label: "Paramètres", icon: Settings, roles: ["ADMIN"] },
  { href: "/admin/audit", label: "Journal d'audit", icon: ScrollText, roles: ["ADMIN"] },
  { href: "/espace", label: "Mon espace client", icon: UserRound },
];

export const customerMobileNav: MobileNavItem[] = [
  { href: "/espace", label: "Accueil", icon: Home, exact: true },
  { href: "/espace/commandes", label: "Commandes", icon: ClipboardList },
  { href: "/espace/commandes/nouvelle", label: "Commander", icon: PlusCircle, primary: true },
  { href: "/espace/notifications", label: "Alertes", icon: Bell },
];

export const adminMobileNav: MobileNavItem[] = [
  { href: "/admin", label: "Accueil", icon: LayoutDashboard, exact: true },
  { href: "/admin/production", label: "Production", icon: Factory },
  { href: "/admin/commandes", label: "Commandes", icon: ClipboardList },
  { href: "/admin/groupes", label: "Groupes", icon: UsersRound },
];

/** Parcours en plein écran sur mobile (barre de navigation basse masquée). */
export const focusRoutes = ["/espace/commandes/nouvelle"];
