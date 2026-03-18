/**
 * Error Pages Schema Unit Tests
 *
 * Tests for the error pages database schema definitions.
 */

import { describe, it, expect } from "vitest";
import {
  errorPages,
  errorPageTypeEnum,
  type ErrorPage,
  type NewErrorPage,
} from "../../../../../packages/database/src/schema/error-pages";

describe("Error Pages Schema", () => {
  // ============================================================================
  // Enum Tests
  // ============================================================================

  describe("errorPageTypeEnum", () => {
    it("should define all expected error page types", () => {
      const enumValues = errorPageTypeEnum.enumValues;

      expect(enumValues).toContain("503");
      expect(enumValues).toContain("404");
      expect(enumValues).toContain("500");
      expect(enumValues).toContain("502");
      expect(enumValues).toContain("504");
      expect(enumValues).toContain("maintenance");
      expect(enumValues).toContain("custom");
    });

    it("should have exactly 7 types", () => {
      expect(errorPageTypeEnum.enumValues).toHaveLength(7);
    });

    it("should have correct enum name", () => {
      expect(errorPageTypeEnum.enumName).toBe("error_page_type");
    });
  });

  // ============================================================================
  // Table Structure Tests
  // ============================================================================

  describe("errorPages table", () => {
    it("should have id as primary key", () => {
      const idColumn = errorPages.id;
      expect(idColumn.name).toBe("id");
      expect(idColumn.dataType).toBe("string");
    });

    it("should have name as required field", () => {
      const nameColumn = errorPages.name;
      expect(nameColumn.name).toBe("name");
      expect(nameColumn.notNull).toBe(true);
    });

    it("should have type as required field", () => {
      const typeColumn = errorPages.type;
      expect(typeColumn.name).toBe("type");
      expect(typeColumn.notNull).toBe(true);
    });

    it("should have httpStatusCode as optional field", () => {
      const httpStatusCodeColumn = errorPages.httpStatusCode;
      expect(httpStatusCodeColumn.name).toBe("http_status_code");
      expect(httpStatusCodeColumn.notNull).toBe(false);
    });

    it("should have directoryPath as required field", () => {
      const directoryPathColumn = errorPages.directoryPath;
      expect(directoryPathColumn.name).toBe("directory_path");
      expect(directoryPathColumn.notNull).toBe(true);
    });

    it("should have entryFile with default index.html", () => {
      const entryFileColumn = errorPages.entryFile;
      expect(entryFileColumn.name).toBe("entry_file");
      expect(entryFileColumn.notNull).toBe(true);
      expect(entryFileColumn.hasDefault).toBe(true);
    });

    it("should have file info fields", () => {
      expect(errorPages.originalZipName.name).toBe("original_zip_name");
      expect(errorPages.uploadedAt.name).toBe("uploaded_at");
      expect(errorPages.fileSize.name).toBe("file_size");
      expect(errorPages.fileCount.name).toBe("file_count");
    });

    it("should have description as optional field", () => {
      const descriptionColumn = errorPages.description;
      expect(descriptionColumn.name).toBe("description");
      expect(descriptionColumn.notNull).toBe(false);
    });

    it("should have previewImagePath as optional field", () => {
      const previewImagePathColumn = errorPages.previewImagePath;
      expect(previewImagePathColumn.name).toBe("preview_image_path");
      expect(previewImagePathColumn.notNull).toBe(false);
    });

    it("should have timestamps", () => {
      expect(errorPages.createdAt.name).toBe("created_at");
      expect(errorPages.updatedAt.name).toBe("updated_at");
      expect(errorPages.createdAt.notNull).toBe(true);
      expect(errorPages.updatedAt.notNull).toBe(true);
    });
  });

  // ============================================================================
  // Type Tests
  // ============================================================================

  describe("ErrorPage types", () => {
    it("should export ErrorPage select type", () => {
      const errorPage: ErrorPage = {
        id: "error-1",
        name: "Service Unavailable",
        type: "503",
        httpStatusCode: null,
        directoryPath: "/error-pages/503",
        entryFile: "index.html",
        originalZipName: "503-error.zip",
        uploadedAt: new Date(),
        fileSize: 15000,
        fileCount: 5,
        description: "Displayed when backend is down",
        previewImagePath: "/previews/error-1.png",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(errorPage.id).toBe("error-1");
      expect(errorPage.type).toBe("503");
      expect(errorPage.entryFile).toBe("index.html");
    });

    it("should export NewErrorPage insert type with minimal fields", () => {
      const newErrorPage: NewErrorPage = {
        id: "error-1",
        name: "Not Found",
        type: "404",
        directoryPath: "/error-pages/404",
      };

      expect(newErrorPage.id).toBe("error-1");
      expect(newErrorPage.name).toBe("Not Found");
      expect(newErrorPage.directoryPath).toBe("/error-pages/404");
    });

    it("should allow all error page types", () => {
      const types: ErrorPage["type"][] = [
        "503",
        "404",
        "500",
        "502",
        "504",
        "maintenance",
        "custom",
      ];

      types.forEach(type => {
        const errorPage: Partial<ErrorPage> = { type };
        expect(errorPage.type).toBe(type);
      });
    });

    it("should handle custom error page with status code", () => {
      const customErrorPage: Partial<ErrorPage> = {
        type: "custom",
        httpStatusCode: 418, // I'm a teapot
        name: "I'm a Teapot",
      };

      expect(customErrorPage.type).toBe("custom");
      expect(customErrorPage.httpStatusCode).toBe(418);
    });

    it("should handle maintenance error page", () => {
      const maintenancePage: Partial<ErrorPage> = {
        type: "maintenance",
        name: "Scheduled Maintenance",
        description: "Displayed during scheduled maintenance windows",
      };

      expect(maintenancePage.type).toBe("maintenance");
      expect(maintenancePage.description).toBeDefined();
    });

    it("should handle error page with file info", () => {
      const errorPage: Partial<ErrorPage> = {
        originalZipName: "custom-error.zip",
        uploadedAt: new Date(),
        fileSize: 50000,
        fileCount: 10,
      };

      expect(errorPage.fileSize).toBe(50000);
      expect(errorPage.fileCount).toBe(10);
    });
  });
});
