import { Redirect, Route, useLocation } from "wouter";
import { useAuth } from "../hooks/useAuth";
import { Spinner } from "@/components/ui/spinner";
import React from "react";

export function ProtectedRoute({
  component: Component,
  path,
  allowedRoles,
}: {
  component: React.ComponentType<any>;
  path: string;
  allowedRoles?: string[];
}) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const [, setLocation] = useLocation();

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <Spinner className="h-8 w-8 text-primary" />
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return <Redirect to="/login" />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Redirect to="/dashboard" />;
  }

  return (
    <Route path={path}>
      {(params) => <Component params={params} />}
    </Route>
  );
}
