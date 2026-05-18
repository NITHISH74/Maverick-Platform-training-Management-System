import { useListFeedback } from "@workspace/api-client-react";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export default function Feedback() {
  const { data: feedback, isLoading } = useListFeedback();

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Feedback</h1>
            <p className="text-muted-foreground">Candidate feedback and sentiment analysis.</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Recent Responses</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch</TableHead>
                  <TableHead>Candidate</TableHead>
                  <TableHead>Content Rating</TableHead>
                  <TableHead>Trainer Rating</TableHead>
                  <TableHead>Sentiment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                   <TableRow>
                     <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading feedback...</TableCell>
                   </TableRow>
                 ) : feedback?.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.batchName}</TableCell>
                    <TableCell>{item.candidateName || "Anonymous"}</TableCell>
                    <TableCell>{item.contentRating} / 5</TableCell>
                    <TableCell>{item.trainerRating} / 5</TableCell>
                    <TableCell>
                      {item.sentiment && (
                        <Badge variant="outline" className={
                          item.sentiment === 'positive' ? 'border-green-500 text-green-500' :
                          item.sentiment === 'negative' ? 'border-destructive text-destructive' : ''
                        }>
                          {item.sentiment}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
