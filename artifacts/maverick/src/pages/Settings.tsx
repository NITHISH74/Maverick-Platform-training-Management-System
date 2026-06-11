import { useState, useEffect } from "react";
import { useGetTopperConfig, getGetTopperConfigQueryKey, useUpdateTopperConfig } from "@workspace/api-client-react";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Settings2, Save, Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Slider } from "@/components/ui/slider";
import { useAuth } from "@/hooks/useAuth";

export default function Settings() {
  const { toast } = useToast();
  const { user } = useAuth();
  // Mirror the existing pattern from Batches.tsx / Dashboard.tsx — trainers
  // see the page (so the walkthrough's "Topper weightages" pointer doesn't
  // 404) but cannot edit. Server-side PATCH /api/topper-config returns 403
  // for trainers as defence in depth.
  const canEdit = user?.role === "admin" || user?.role === "coordinator";
  const { data: config, isLoading } = useGetTopperConfig({
    query: { queryKey: getGetTopperConfigQueryKey() }
  });

  const updateMutation = useUpdateTopperConfig();

  const [assessmentWeight, setAssessmentWeight] = useState(0);
  const [projectWeight, setProjectWeight] = useState(0);
  const [attendanceWeight, setAttendanceWeight] = useState(0);

  useEffect(() => {
    if (config) {
      setAssessmentWeight(config.assessmentWeight);
      setProjectWeight(config.projectWeight);
      setAttendanceWeight(config.attendanceWeight);
    }
  }, [config]);

  const total = assessmentWeight + projectWeight + attendanceWeight;
  const isValid = total === 100;

  const handleSave = () => {
    if (!isValid) return;
    
    updateMutation.mutate({
      data: {
        assessmentWeight,
        projectWeight,
        attendanceWeight
      }
    }, {
      onSuccess: () => {
        toast({
          title: "Configuration Saved",
          description: "Topper calculation weights have been updated.",
        });
      }
    });
  };

  return (
    <Layout>
      <div className="space-y-6 max-w-3xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">System Settings</h1>
            <p className="text-muted-foreground">Global configuration parameters.</p>
          </div>
        </div>

        <Card className="border-border shadow-sm">
          <CardHeader className="bg-muted/30 border-b pb-4">
            <CardTitle className="flex items-center">
              <Settings2 className="mr-2 h-5 w-5" />
              Topper Calculation Weights
            </CardTitle>
            <CardDescription>
              Adjust the weightage given to different components when calculating the final leaderboard score. Total must equal 100%.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-8 pt-6">
            {!canEdit && (
              <div
                className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
                data-testid="weightage-readonly-notice"
              >
                <Lock className="h-4 w-4 mt-0.5 shrink-0" />
                <p>Weightage configuration is managed by coordinators and admins.</p>
              </div>
            )}
            {isLoading ? (
              <div className="space-y-6">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : (
              <>
                <div className="space-y-4 border rounded-md p-6 relative bg-card">
                  <div className="flex justify-between items-center mb-2">
                    <Label className="text-base font-semibold">Assessments Weight</Label>
                    <span className="font-mono font-bold text-lg">{assessmentWeight}%</span>
                  </div>
                  <Slider
                    value={[assessmentWeight]}
                    max={100}
                    step={5}
                    onValueChange={(val) => setAssessmentWeight(val[0])}
                    className="py-4"
                    disabled={!canEdit}
                  />
                  <p className="text-sm text-muted-foreground">Weight applied to the average of all sprint and coding assessments.</p>
                </div>

                <div className="space-y-4 border rounded-md p-6 relative bg-card">
                  <div className="flex justify-between items-center mb-2">
                    <Label className="text-base font-semibold">Project Weight</Label>
                    <span className="font-mono font-bold text-lg">{projectWeight}%</span>
                  </div>
                  <Slider
                    value={[projectWeight]}
                    max={100}
                    step={5}
                    onValueChange={(val) => setProjectWeight(val[0])}
                    className="py-4"
                    disabled={!canEdit}
                  />
                  <p className="text-sm text-muted-foreground">Weight applied to the final capstone project evaluation.</p>
                </div>

                <div className="space-y-4 border rounded-md p-6 relative bg-card">
                  <div className="flex justify-between items-center mb-2">
                    <Label className="text-base font-semibold">Attendance Weight</Label>
                    <span className="font-mono font-bold text-lg">{attendanceWeight}%</span>
                  </div>
                  <Slider
                    value={[attendanceWeight]}
                    max={100}
                    step={5}
                    onValueChange={(val) => setAttendanceWeight(val[0])}
                    className="py-4"
                    disabled={!canEdit}
                  />
                  <p className="text-sm text-muted-foreground">Weight applied to the overall attendance percentage.</p>
                </div>

                <div className={`p-4 rounded-md flex items-center justify-between font-bold border-2 ${isValid ? 'bg-green-50 border-green-200 text-green-800' : 'bg-destructive/10 border-destructive/30 text-destructive'}`}>
                  <span>Total Weight Allocation</span>
                  <span className="text-xl">{total}%</span>
                </div>
                {!isValid && canEdit && (
                  <p className="text-sm text-destructive font-medium text-right">Total must equal exactly 100%.</p>
                )}
              </>
            )}
          </CardContent>
          {canEdit && (
            <CardFooter className="bg-muted/30 border-t justify-end py-4">
              <Button
                onClick={handleSave}
                disabled={isLoading || !isValid || updateMutation.isPending}
              >
                <Save className="mr-2 h-4 w-4" />
                {updateMutation.isPending ? "Saving..." : "Save Configuration"}
              </Button>
            </CardFooter>
          )}
        </Card>
      </div>
    </Layout>
  );
}
