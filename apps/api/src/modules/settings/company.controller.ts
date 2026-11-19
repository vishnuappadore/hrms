import { Body, Controller, Get, Patch, Post } from "@nestjs/common";
import { Permissions } from "../../common/decorators";
import { CompanyService } from "./company.service";
import { PresignCompanyLogoDto, UpdateCompanySettingsDto } from "./company.dto";

@Controller("settings/company")
export class CompanyController {
  constructor(private readonly company: CompanyService) {}

  @Get()
  @Permissions("settings.company.manage")
  get() {
    return this.company.get();
  }

  @Patch()
  @Permissions("settings.company.manage")
  update(@Body() dto: UpdateCompanySettingsDto) {
    return this.company.update(dto);
  }

  @Post("logo-upload-url")
  @Permissions("settings.company.manage")
  presignLogoUpload(@Body() dto: PresignCompanyLogoDto) {
    return this.company.presignLogoUpload(dto);
  }
}
