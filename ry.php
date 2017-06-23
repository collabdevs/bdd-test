<?php

require_once "Spyc.php";
$dados = Spyc::YAMLLoad('Store.yml');


function camelize($input, $separator = '_'){
    return str_replace($separator, '', ucwords($input, $separator));
}


function decamelize($string) {
	return strtolower(preg_replace(['/([a-z\d])([A-Z])/', '/([^_])([A-Z][a-z])/'], '$1_$2', $string));
}

function endsWith($haystack, $needle)
{
    return $needle === '' || substr_compare($haystack, $needle, -strlen($needle)) === 0;
}

$belongs = '';
foreach ($dados as $nome => $value) {
	$entidade = $nome;
	echo PHP_EOL.'criando form para '.$entidade.PHP_EOL;
	echo 'campos : [ ';
	$campos ='<span ng-controller="formCtrl"><input type="text" ng-model="loaded_entity.id">';
	
	foreach ($value['fields'] as $k => $campo) {
		$nome_campo = $k;
		echo '"'.$nome_campo.'" ';

		if($campo['schema'] == 'string'){	
			$campos .='<div class="form-group"><label class="col-sm-2 control-label">'.strtoupper($nome_campo).'</label>
	            <div class="col-sm-10"><input type="text" class="form-control" ng-model="loaded_entity.'.$nome_campo.'" name="'.$nome_campo.'"></div>
	        </div>
	        <div class="hr-line-dashed"></div>';
		}elseif($campo['schema'] == 'integer'){	
			if(endsWith($nome_campo , '_id')){
				$belongs = substr($nome_campo, 0, -3).',';

				$campos .='<div class="form-group">
				<label class="col-sm-2 control-label">Pertence :</label>
				    <div class="col-sm-10">
				    <select class="form-control m-b" name="'.$nome_campo.'" ng-model="loaded_entity.'.$nome_campo.'">
				        <option ng-repeat="relation in '.substr($nome_campo, 0, -3).'[0]" value="{{relation.id}}">{{relation.name}}</option>
				    </select>
				    </div>
				</div>';
			}else{
				$campos .='<div class="form-group"><label class="col-sm-2 control-label">'.strtoupper($nome_campo).'</label>
	            <div class="col-sm-10"><input type="text" class="form-control" ng-model="loaded_entity.'.$nome_campo.'" name="'.$nome_campo.'"></div>
	        </div>
	        <div class="hr-line-dashed"></div>';
			}
			
		}else{
			$campos .='<div class="form-group"><label class="col-sm-2 control-label">Normal</label>
	            <div class="col-sm-10"><input type="text" class="form-control"></div>
	        </div>
	        <div class="hr-line-dashed"></div>';
		}

	}

	/*

	testar se o campo tem o nome terminado em _id  e for do tipo integer
	fazer carregar o drop down

	*/




	echo ']';
	if(isset($value['belongsTo'])){
		$belong = $value['belongsTo'];
		$belongs .= $value['belongsTo'].',';
		$campos .='<input type="hidden" class="form-control" id="relation" value="'.$belong.'">
			<div class="form-group">
			<label class="col-sm-2 control-label">Pertence : </label>
			    <div class="col-sm-10">
			    <select class="form-control m-b" name="'.$belong.'_id" ng-model="loaded_entity.'.$belong.'_id">
			        <option ng-repeat="relation in '.$belong.'[0]" value="{{relation.id}}">{{relation.name}}</option>
			    </select>
			    </div>
			</div>
		</span>';
	}
	$campos .='<input type="hidden" class="form-control" id="pertences" value="'.$belongs.'">';
	try {
		file_put_contents('public/adm/views/models/'.strtolower(decamelize($entidade)).'.html', $campos);
		echo PHP_EOL.' Arquivo '.strtolower(decamelize($entidade)).'.html gerado com sucesso'.PHP_EOL;
	} catch (Exception $e) {
		
	}
	
}
