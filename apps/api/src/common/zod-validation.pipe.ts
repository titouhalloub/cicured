import { BadRequestException, Injectable, type PipeTransform } from "@nestjs/common";
import { ZodObject, type ZodType } from "zod";

/**
 * Validates request input with a shared zod schema. Every value crossing a
 * trust boundary is validated (Spec §8 "Zod-validate everything").
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    // Body-less JSON requests arrive as undefined; treat them as {} so
    // all-optional body schemas (e.g. CreateRunInput) still validate.
    const input = value === undefined && this.schema instanceof ZodObject ? {} : value;
    const parsed = this.schema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "validation failed",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
    return parsed.data;
  }
}
