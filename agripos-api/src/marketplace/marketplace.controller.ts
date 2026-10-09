import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Delete,
  Optional,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MarketplaceService } from './marketplace.service';
import { VouchersService } from './vouchers.service';
import { RatingDto, VerificationDto } from './agrilink-trust.dto';
import { DealerServiceDto } from './dealer-services.dto';
import {
  BuyOfferDto,
  CancelOrderDto,
  ManageProductsQuery,
  PlaceOrderDto,
  ProductListingDto,
  ProfileDto,
  UpdateBuyOfferDto,
} from './marketplace.dto';

type AuthRequest = { user: { userId: string } };

@Controller('api/v1/marketplace')
@UseGuards(JwtAuthGuard)
export class MarketplaceController {
  constructor(
    private readonly service: MarketplaceService,
    @Optional() private readonly vouchers?: VouchersService,
  ) {}

  @Get('dealers') dealers(@Query('q') q?: string, @Query('crop') crop?: string, @Query('province') province?: string) {
    return this.service.dealers(q, crop, province);
  }
  @Get('dealers/:id') async dealer(@Req() r: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    const [store, vouchers] = await Promise.all([
      this.service.dealer(id),
      this.vouchers?.forStorefront(id, r.user.userId) ?? [],
    ]);
    return { ...store, vouchers };
  }
  @Get('dealers/:id/ratings') ratings(@Param('id', ParseUUIDPipe) id: string, @Query('page') raw?: string) {
    const page = Number(raw ?? 1);
    if (!Number.isInteger(page) || page < 1 || page > 100000) throw new BadRequestException('Trang không hợp lệ.');
    return this.service.ratings(id,page);
  }
  @Get('manage/profile') async profile(@Req() r: AuthRequest) {
    return this.service.profile(await this.service.viewer(r.user.userId));
  }
  @Patch('manage/profile') async updateProfile(
    @Req() r: AuthRequest,
    @Body() dto: ProfileDto,
  ) {
    return this.service.updateProfile(
      await this.service.viewer(r.user.userId),
      dto,
    );
  }
  @Get('manage/services') async services(@Req() r: AuthRequest) {
    return this.service.services(await this.service.viewer(r.user.userId));
  }
  @Put('manage/services/:kind') async putService(
    @Req() r: AuthRequest,
    @Param('kind') kind: string,
    @Body() dto: DealerServiceDto,
  ) {
    return this.service.putService(await this.service.viewer(r.user.userId), kind, dto);
  }
  @Post('manage/profile/logo')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 2 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!/^image\/(jpeg|png|jpg|webp)$/.test(file.mimetype)) {
          cb(
            new BadRequestException(
              'Chỉ chấp nhận file ảnh JPEG, PNG hoặc WebP',
            ),
            false,
          );
          return;
        }
        cb(null, true);
      },
    }),
  )
  async uploadLogo(
    @Req() r: AuthRequest,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.service.uploadLogo(
      await this.service.viewer(r.user.userId),
      file,
    );
  }
  @Post('manage/profile/cover')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!/^image\/(jpeg|png|jpg|webp)$/.test(file.mimetype)) {
          cb(
            new BadRequestException(
              'Chỉ chấp nhận file ảnh JPEG, PNG hoặc WebP',
            ),
            false,
          );
          return;
        }
        cb(null, true);
      },
    }),
  )
  async uploadCover(
    @Req() r: AuthRequest,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.service.uploadCover(
      await this.service.viewer(r.user.userId),
      file,
    );
  }
  @Get('manage/products') async listProducts(
    @Req() r: AuthRequest,
    @Query() q: ManageProductsQuery,
  ) {
    return this.service.listProducts(
      await this.service.viewer(r.user.userId),
      q,
    );
  }
  @Post('manage/products/:productId/images')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!/^image\/(jpeg|png|jpg|webp)$/.test(file.mimetype)) {
          cb(new BadRequestException('Chỉ chấp nhận file ảnh JPEG, PNG hoặc WebP'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  async uploadListingImage(
    @Req() r: AuthRequest,
    @Param('productId', ParseUUIDPipe) productId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.service.uploadListingImage(await this.service.viewer(r.user.userId), productId, file);
  }
  @Put('manage/products/:productId') async setProduct(
    @Req() r: AuthRequest,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: ProductListingDto,
  ) {
    return this.service.setProduct(
      await this.service.viewer(r.user.userId),
      productId,
      dto,
    );
  }
  @Get('manage/buy-offers') async buyOffers(@Req() r: AuthRequest) {
    return this.service.buyOffers(await this.service.viewer(r.user.userId));
  }
  @Post('manage/buy-offers/confirm-all') async confirmAllBuyOffers(@Req() r: AuthRequest) {
    return this.service.confirmAllBuyOffers(await this.service.viewer(r.user.userId));
  }
  @Post('manage/buy-offers/:id/confirm-price') async confirmBuyOffer(@Req() r: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.confirmBuyOffer(await this.service.viewer(r.user.userId),id);
  }
  @Get('manage/ratings') async manageRatings(@Req() r: AuthRequest, @Query('page') raw?: string) {
    const page = Number(raw ?? 1);
    if (!Number.isInteger(page) || page < 1 || page > 100000) throw new BadRequestException('Trang không hợp lệ.');
    return this.service.manageRatings(await this.service.viewer(r.user.userId),page);
  }
  @Get('manage/verification') async verification(@Req() r: AuthRequest) {
    return this.service.verification(await this.service.viewer(r.user.userId));
  }
  @Post('manage/verification') async submitVerification(@Req() r: AuthRequest, @Body() dto: VerificationDto) {
    return this.service.submitVerification(await this.service.viewer(r.user.userId),dto);
  }
  @Post('manage/buy-offers') async buyOffer(
    @Req() r: AuthRequest,
    @Body() dto: BuyOfferDto,
  ) {
    return this.service.addBuyOffer(
      await this.service.viewer(r.user.userId),
      dto,
    );
  }
  @Patch('manage/buy-offers/:id') async updateBuyOffer(
    @Req() r: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBuyOfferDto,
  ) {
    return this.service.updateBuyOffer(
      await this.service.viewer(r.user.userId),
      id,
      dto,
    );
  }
  @Delete('manage/buy-offers/:id') async removeBuyOffer(
    @Req() r: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.removeBuyOffer(
      await this.service.viewer(r.user.userId),
      id,
    );
  }
  @Post('dealers/:id/orders')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async placeOrder(
    @Req() r: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PlaceOrderDto,
  ) {
    return this.service.placeOrder(
      await this.service.viewer(r.user.userId),
      id,
      dto,
    );
  }
  @Get('my-orders') async myOrders(
    @Req() r: AuthRequest,
    @Query('status') status?: string,
  ) {
    return this.service.myOrders(
      await this.service.viewer(r.user.userId),
      status,
    );
  }
  @Get('my-orders/:id') async myOrder(
    @Req() r: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.myOrder(await this.service.viewer(r.user.userId), id);
  }
  @Post('my-orders/:id/rating') async rate(@Req() r: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RatingDto) {
    return this.service.rate(await this.service.viewer(r.user.userId),id,dto);
  }
  @Post('my-orders/:id/cancel') async cancel(
    @Req() r: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelOrderDto,
  ) {
    return this.service.cancelMyOrder(
      await this.service.viewer(r.user.userId),
      id,
      dto.reason,
    );
  }
}
