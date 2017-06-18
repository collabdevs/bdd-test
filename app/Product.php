<?php namespace App;

use Illuminate\Database\Eloquent\Model;

class Product extends Model {

    use \Illuminate\Database\Eloquent\SoftDeletes;

    protected $fillable = ["name", "desc", "published_at", "price", "store_id"];

    protected $dates = ["published_at"];

    public static $rules = [
        "name" => "required",
        "published_at" => "date",
        "price" => "numeric",
        "store_id" => "required|numeric",
    ];

    public function store()
    {
        return $this->belongsTo("App\Store");
    }


}
