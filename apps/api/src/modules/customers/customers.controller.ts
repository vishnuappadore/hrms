import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { Permissions } from "../../common/decorators";
import { CustomersService } from "./customers.service";
import {
  CreateCustomerDto,
  ListCustomersQueryDto,
  PresignCustomerPhotoDto,
  UpdateCustomerDto,
} from "./customers.dto";

// Customers are tenant-wide master records — no @BranchScoped (RLS scopes by tenant).
@Controller("customers")
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @Permissions("customers.view")
  list(@Query() query: ListCustomersQueryDto) {
    return this.customers.list(query);
  }

  @Get(":customerId")
  @Permissions("customers.view")
  getById(@Param("customerId") customerId: string) {
    return this.customers.getById(customerId);
  }

  @Post()
  @Permissions("customers.create")
  create(@Body() dto: CreateCustomerDto) {
    return this.customers.create(dto);
  }

  @Post("photo-upload-url")
  @Permissions("customers.create")
  presignPhotoUpload(@Body() dto: PresignCustomerPhotoDto) {
    return this.customers.presignPhotoUpload(dto);
  }

  @Patch(":customerId")
  @Permissions("customers.update")
  update(@Param("customerId") customerId: string, @Body() dto: UpdateCustomerDto) {
    return this.customers.update(customerId, dto);
  }
}
