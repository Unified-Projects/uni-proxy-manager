"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  useToast,
} from "@uni-proxy-manager/ui";
import { useCreateErrorPage } from "@/hooks/use-error-pages";

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.enum(["503", "404", "500", "502", "504", "custom"]),
  httpStatusCode: z.coerce.number().min(100).max(599).optional(),
  description: z.string().optional(),
});

type FormData = z.infer<typeof formSchema>;

interface CreateErrorPageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateErrorPageDialog({
  open,
  onOpenChange,
}: CreateErrorPageDialogProps) {
  const { toast } = useToast();
  const createErrorPage = useCreateErrorPage();

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      type: "503",
      description: "",
    },
  });

  const pageType = form.watch("type");

  const onSubmit = async (data: FormData) => {
    try {
      await createErrorPage.mutateAsync({
        name: data.name,
        type: data.type,
        httpStatusCode: data.type === "custom" ? data.httpStatusCode : undefined,
        description: data.description || undefined,
      });

      toast({
        title: "Error page created",
        description: `${data.name} has been created. Upload files to complete setup.`,
      });

      form.reset();
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to create error page",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create Error Page</DialogTitle>
          <DialogDescription>
            Create a new error page. You can upload files after creation.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="My Error Page" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="503">503 Service Unavailable</SelectItem>
                      <SelectItem value="404">404 Not Found</SelectItem>
                      <SelectItem value="500">500 Internal Server Error</SelectItem>
                      <SelectItem value="502">502 Bad Gateway</SelectItem>
                      <SelectItem value="504">504 Gateway Timeout</SelectItem>
                      <SelectItem value="custom">Custom HTTP Status</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    {pageType === "503" && "Shown when backend servers are down"}
                    {pageType === "404" && "Shown when a page is not found"}
                    {pageType === "500" && "Shown on internal server errors"}
                    {pageType === "502" && "Shown when the backend is unreachable"}
                    {pageType === "504" && "Shown when the backend times out"}
                    {pageType === "custom" && "Custom error page for any HTTP status"}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {pageType === "custom" && (
              <FormField
                control={form.control}
                name="httpStatusCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>HTTP Status Code</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={100}
                        max={599}
                        placeholder="500"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      HTTP status code (100-599)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description (optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="A brief description of this error page"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createErrorPage.isPending}>
                {createErrorPage.isPending ? "Creating..." : "Create Error Page"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
