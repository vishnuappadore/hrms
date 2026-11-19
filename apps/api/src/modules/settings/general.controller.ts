import { Body, Controller, Get, Patch } from "@nestjs/common";
import { Permissions } from "../../common/decorators";
import { GeneralSettingsService } from "./general.service";
import { UpdateGeneralSettingsDto } from "./general.dto";

@Controller("settings/general")
export class GeneralSettingsController {
  constructor(private readonly general: GeneralSettingsService) {}

  @Get()
  @Permissions("settings.general.manage")
  get() {
    return this.general.get();
  }

  @Patch()
  @Permissions("settings.general.manage")
  update(@Body() dto: UpdateGeneralSettingsDto) {
    return this.general.update(dto);
  }
}
