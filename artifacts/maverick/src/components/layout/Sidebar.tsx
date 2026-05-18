import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import {
  LayoutDashboard,
  Users,
  GraduationCap,
  CalendarCheck,
  ClipboardCheck,
  Trophy,
  MessageSquare,
  Bell,
  Settings,
  Shield,
  Activity,
  PanelLeftClose,
  PanelLeftOpen,
  BarChart2,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["admin", "coordinator", "trainer"] },
  { href: "/batches", label: "Batches", icon: Users, roles: ["admin", "coordinator", "trainer"] },
  { href: "/candidates", label: "Candidates", icon: GraduationCap, roles: ["admin", "coordinator", "trainer"] },
  { href: "/attendance", label: "Attendance", icon: CalendarCheck, roles: ["admin", "coordinator", "trainer"] },
  { href: "/assessments", label: "Assessments", icon: ClipboardCheck, roles: ["admin", "coordinator", "trainer"] },
  { href: "/toppers", label: "Toppers", icon: Trophy, roles: ["admin", "coordinator"] },
  { href: "/feedback", label: "Feedback", icon: MessageSquare, roles: ["admin", "coordinator", "trainer"] },
  { href: "/reports", label: "Reports", icon: BarChart2, roles: ["admin", "coordinator"] },
  { href: "/notifications", label: "Notifications", icon: Bell, roles: ["admin", "coordinator", "trainer"] },
  { href: "/users", label: "Users", icon: Shield, roles: ["admin"] },
  { href: "/audit", label: "Audit Log", icon: Activity, roles: ["admin", "coordinator"] },
  { href: "/settings", label: "Settings", icon: Settings, roles: ["admin", "coordinator"] },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const [location] = useLocation();
  const { user } = useAuth();

  if (!user) return null;

  const filteredItems = NAV_ITEMS.filter(item => item.roles.includes(user.role));

  return (
    <div
      className={cn(
        "flex h-full flex-col bg-sidebar border-r border-sidebar-border text-sidebar-foreground transition-all duration-300",
        collapsed ? "w-16" : "w-64"
      )}
    >
      <div
        className={cn(
          "flex h-14 items-center border-b border-sidebar-border cursor-pointer select-none group",
          collapsed ? "justify-center px-0" : "justify-between px-4"
        )}
        onClick={onToggle}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {!collapsed && (
          <span className="font-bold text-xl tracking-tight text-sidebar-primary">
            Maverick.
          </span>
        )}
        <span className={cn("text-sidebar-foreground/50 group-hover:text-sidebar-primary transition-colors", collapsed && "mx-auto")}>
          {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto py-4">
        <nav className={cn("space-y-1", collapsed ? "px-2" : "px-3")}>
          {filteredItems.map((item) => {
            const isActive = location.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center rounded-md text-sm font-medium transition-colors",
                  collapsed ? "justify-center px-0 py-2" : "gap-3 px-3 py-2",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}
                title={collapsed ? item.label : undefined}
              >
                <item.icon className={cn("h-4 w-4 shrink-0", isActive ? "text-primary" : "text-sidebar-foreground/50")} />
                {!collapsed && item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
